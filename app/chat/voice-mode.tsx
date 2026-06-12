"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Settings2 } from "lucide-react";
import { BlackHole } from "@/components/black-hole";

// Full-screen, self-contained "talk to Nillad" voice mode — launchable from the
// home bar or inside a chat. A synthetic-brain orb (canvas sphere of points)
// breathes when idle, reacts to YOUR voice while listening, swirls while
// thinking, and pulses to Nillad's voice amplitude while speaking.
//
// STT: MediaRecorder → local Whisper (/api/stt) — NOT the Web Speech API, so it
// works on iOS Safari / Arc. A simple VAD auto-stops on ~1.2s of silence.
// Loop: record → transcribe → ask the agent (/api/chat) → speak (Kokoro) → record.

type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";
type ChatMsg = { role: "user" | "assistant"; content: string };

const VOICES: { id: string; label: string }[] = [
  { id: "af_heart", label: "Heart — F, warm" },
  { id: "af_bella", label: "Bella — F" },
  { id: "af_nicole", label: "Nicole — F, soft" },
  { id: "af_sky", label: "Sky — F" },
  { id: "am_michael", label: "Michael — M" },
  { id: "am_adam", label: "Adam — M" },
  { id: "am_onyx", label: "Onyx — M, deep" },
  { id: "am_puck", label: "Puck — M" },
  { id: "bm_george", label: "George — M, Brit" },
  { id: "bm_fable", label: "Fable — M, Brit" },
];

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Tap to talk",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "",
};

export function VoiceMode({
  onClose,
  initialMessages = [],
}: {
  onClose: () => void;
  initialMessages?: ChatMsg[];
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voice, setVoice] = useState("af_heart");

  const activeRef = useRef(true);
  const phaseRef = useRef<Phase>("idle");
  const levelRef = useRef(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const stopRecRef = useRef<() => void>(() => {});
  const vadRaf = useRef(0);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // Conversation history kept for this voice session (seeded from the open chat).
  const historyRef = useRef<ChatMsg[]>(initialMessages.map((m) => ({ role: m.role, content: m.content })));

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  useEffect(() => {
    try {
      const v = localStorage.getItem("nillad_tts_voice");
      if (v) setVoice(v);
    } catch {
      /* ignore */
    }
  }, []);

  // The black-hole brain reacts to the voice session: it breathes when idle,
  // surges with YOUR voice while listening, spins energetically while thinking,
  // and pulses to Nillad's voice while speaking. Fed to <BlackHole getIntensity>.
  const voiceIntensity = useCallback(() => {
    const ph = phaseRef.current;
    const lvl = levelRef.current;
    if (ph === "listening") return Math.min(1, 0.18 + lvl * 0.95);
    if (ph === "thinking") return 0.55;
    if (ph === "speaking") return Math.min(1, 0.28 + lvl * 1.05);
    if (ph === "error") return 0.0;
    return 0.06;
  }, []);

  // ---- Ask the agent (self-contained: hits /api/chat, keeps its own history) ----
  async function ask(text: string): Promise<string> {
    const history = [...historyRef.current, { role: "user" as const, content: text }];
    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, think: false }),
      });
      if (!res.ok || !res.body) return "";
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const d = s.slice(5).trim();
          if (d === "[DONE]" || !d) continue;
          try {
            const delta = JSON.parse(d).choices?.[0]?.delta?.content;
            if (delta) acc += delta;
          } catch {
            /* status frame or partial — ignore */
          }
        }
      }
    } catch {
      return "";
    }
    if (acc) historyRef.current = [...history, { role: "assistant", content: acc }];
    return acc;
  }

  // ---- Speak a reply (Kokoro TTS) with amplitude analysis ----
  function speak(text: string) {
    if (!activeRef.current || !text.trim()) {
      listen();
      return;
    }
    setPhaseBoth("speaking");
    fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: voiceRef.current }),
    })
      .then(async (res) => {
        if (!res.ok || !activeRef.current) throw new Error("tts");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        // Play through a PLAIN <audio> element — NOT the Web Audio graph — so iOS
        // routes output to Bluetooth/AirPods instead of forcing the phone speaker.
        // (Routing TTS through an AudioContext that touched the mic = speaker-only
        //  on iOS.) The orb gets a synthetic speech-like envelope instead of real
        //  amplitude, which is the right trade for working Bluetooth output.
        let pulse = 0;
        const animate = () => {
          if (audio.paused || audio.ended || !activeRef.current) {
            levelRef.current = 0;
            return;
          }
          pulse += 0.016;
          levelRef.current = Math.min(
            1,
            0.28 + 0.32 * Math.abs(Math.sin(pulse * 7)) + 0.18 * Math.random() * Math.abs(Math.sin(pulse * 2.3)),
          );
          requestAnimationFrame(animate);
        };
        audio.onplay = () => requestAnimationFrame(animate);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          levelRef.current = 0;
          if (activeRef.current) listen();
        };
        audio.play().catch(() => {
          if (activeRef.current) listen();
        });
      })
      .catch(() => {
        levelRef.current = 0;
        if (activeRef.current) {
          setErr("Voice engine unreachable — is the kokoro container up?");
          setPhaseBoth("idle");
        }
      });
  }

  function handleUtterance(text: string) {
    setTranscript(text);
    setPhaseBoth("thinking");
    ask(text)
      .then((reply) => {
        if (!activeRef.current) return;
        if (!reply.trim()) {
          setPhaseBoth("idle");
          return;
        }
        speak(reply);
      })
      .catch(() => {
        if (activeRef.current) setPhaseBoth("idle");
      });
  }

  // ---- Listen: record mic → VAD auto-stop → Whisper STT ----
  async function listen() {
    if (!activeRef.current) return;
    setErr(null);
    setTranscript("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr("Microphone blocked. Allow mic access (and avoid a private/incognito tab) to talk.");
      setPhaseBoth("error");
      return;
    }
    if (!activeRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    micStreamRef.current = stream;
    setPhaseBoth("listening");

    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setErr("Recording isn't supported in this browser.");
      setPhaseBoth("error");
      return;
    }
    recRef.current = mr;
    const chunks: BlobPart[] = [];
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(vadRaf.current);
      try {
        mr.stop();
      } catch {
        /* already stopped */
      }
    };
    stopRecRef.current = stop;

    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      levelRef.current = 0;
      // Drop iOS "record" audio-session so the spoken reply can route to Bluetooth.
      ctxRef.current?.suspend().catch(() => {});
      if (!activeRef.current) return;
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      if (blob.size < 1400) {
        setPhaseBoth("idle");
        return;
      }
      setPhaseBoth("thinking");
      try {
        const res = await fetch("/api/stt", {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm" },
          body: blob,
        });
        const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        const text = (j.text || "").trim();
        if (!text) {
          if (j.error) setErr(j.error);
          setPhaseBoth("idle");
          return;
        }
        handleUtterance(text);
      } catch {
        setErr("Transcription failed.");
        setPhaseBoth("idle");
      }
    };

    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const actx = ctxRef.current || new Ctx();
      ctxRef.current = actx;
      if (actx.state === "suspended") await actx.resume();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let speech = false;
      let silenceAt = 0;
      const startAt = performance.now();
      const vad = () => {
        if (stopped || !activeRef.current) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const level = Math.min(1, sum / data.length / 110);
        levelRef.current = level;
        const now = performance.now();
        if (level > 0.05) {
          speech = true;
          silenceAt = 0;
        } else if (speech) {
          if (!silenceAt) silenceAt = now;
          else if (now - silenceAt > 1200) return stop();
        }
        if (now - startAt > 12000) return stop();
        if (!speech && now - startAt > 6000) return stop();
        vadRaf.current = requestAnimationFrame(vad);
      };
      vadRaf.current = requestAnimationFrame(vad);
    } catch {
      setTimeout(stop, 6000);
    }

    mr.start();
  }

  function onOrbTap() {
    if (phaseRef.current === "speaking") {
      audioRef.current?.pause();
      levelRef.current = 0;
      listen();
    } else if (phaseRef.current === "listening") {
      stopRecRef.current();
    } else {
      listen();
    }
  }

  function cleanup() {
    activeRef.current = false;
    cancelAnimationFrame(vadRaf.current);
    audioRef.current?.pause();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    ctxRef.current?.close().catch(() => {});
  }
  function close() {
    cleanup();
    onClose();
  }
  useEffect(() => cleanup, []);

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center justify-between px-3 py-3 shrink-0">
        <button onClick={() => setPickerOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-bone-dim hover:text-bone text-sm">
          <Settings2 size={16} /> {VOICES.find((v) => v.id === voice)?.label.split(" — ")[0] || "Voice"}
        </button>
        <button onClick={close} aria-label="Close voice mode" className="w-10 h-10 grid place-items-center rounded-full text-bone-dim hover:text-bone">
          <X size={22} />
        </button>
      </div>

      {pickerOpen && (
        <div className="px-4 pb-2 shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {VOICES.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setVoice(v.id);
                  try {
                    localStorage.setItem("nillad_tts_voice", v.id);
                  } catch {
                    /* ignore */
                  }
                  setPickerOpen(false);
                  speak("Hey, this is how I sound now.");
                }}
                className={`px-2.5 py-1.5 rounded-full text-[11px] font-mono transition ${
                  v.id === voice ? "bubble-stroke-gradient text-bone" : "border border-border text-bone-dim hover:text-bone"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-bone-mute mt-1.5">Tap a voice to hear a sample.</p>
        </div>
      )}

      <button onClick={onOrbTap} className="relative flex-1 min-h-0 w-full" aria-label="Tap to talk or interrupt">
        <BlackHole getIntensity={voiceIntensity} />
      </button>

      <div className="shrink-0 px-6 text-center" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
        <div className="text-[13px] uppercase tracking-[0.2em] font-mono text-bone-mute">{err ? "" : PHASE_LABEL[phase]}</div>
        {transcript && phase !== "speaking" && (
          <p className="mt-2 text-[15px] text-bone italic max-w-[36ch] mx-auto line-clamp-3">“{transcript}”</p>
        )}
        {err && <p className="mt-2 text-[13px] text-warmred max-w-[40ch] mx-auto">{err}</p>}
        {phase === "idle" && !err && <p className="mt-2 text-xs text-bone-dim">Tap the black hole and start talking.</p>}
      </div>
    </div>
  );
}
