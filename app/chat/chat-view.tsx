"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Mic, ArrowUp, Loader2, X, ImageIcon, Brain, Copy, Check, RotateCw, Volume2, Square } from "lucide-react";
import { MenuButton } from "@/components/menu-button";
import { Markdown } from "@/components/markdown";
import { VoiceMode } from "./voice-mode";
import { createChat, appendMessage, updateLastAssistant } from "./actions";

type Msg = { role: "user" | "assistant"; content: string; image?: string; hasImage?: boolean };

// Curated natural-sounding Kokoro voices (the full set is large; these are the good ones).
const VOICES: { id: string; label: string }[] = [
  { id: "af_heart", label: "Heart — F, warm" },
  { id: "af_bella", label: "Bella — F" },
  { id: "af_nicole", label: "Nicole — F, soft" },
  { id: "af_sky", label: "Sky — F" },
  { id: "am_michael", label: "Michael — M" },
  { id: "am_adam", label: "Adam — M" },
  { id: "am_onyx", label: "Onyx — M, deep" },
  { id: "am_puck", label: "Puck — M" },
  { id: "bm_george", label: "George — M, British" },
  { id: "bm_fable", label: "Fable — M, British" },
];

export function ChatView({
  chatId: initialChatId = null,
  initialMessages = [],
  initialQ = "",
  tools,
}: {
  chatId?: number | null;
  initialMessages?: Msg[];
  initialQ?: string;
  // Optional per-surface tool scoping. Omitted → the API uses the full default
  // set (correct for general chat). A narrow surface can pass e.g.
  // ["send_sms","jobs_contacts","get_time"] to focus tool selection.
  tools?: string[];
}) {
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Live "what Nillad is doing" line ("Searching the web for …") streamed from the
  // agent and shown in the pending bubble until the real answer starts arriving.
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  // "Think harder" — sticky toggle. Off = snappy ~1-2s replies; on = Nillad runs
  // a full chain-of-thought first (slower, deeper) until turned back off.
  const [thinkHard, setThinkHard] = useState(false);
  // Voice mode — a full-screen, hands-free "talk to Nillad" experience with a
  // reactive synthetic-brain visual (self-contained; see voice-mode.tsx).
  const [voiceMode, setVoiceMode] = useState(false);
  const chatIdRef = useRef<number | null>(initialChatId);
  const sent = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  // Build the API payload from a message history; the LAST message goes multimodal
  // if it carries an image (prior turns are sent as text).
  function buildApiMessages(history: Msg[]) {
    return history.map((m, i) => {
      if (i === history.length - 1 && m.image) {
        return {
          role: m.role,
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            { type: "image_url", image_url: { url: m.image } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  const abortRef = useRef<AbortController | null>(null);

  function stop() {
    abortRef.current?.abort();
  }

  // Stream one assistant reply for the given history (which ends at a user turn).
  // replace=true overwrites the last persisted assistant row (Retry); otherwise a
  // new assistant row is appended.
  async function streamAssistant(history: Msg[], cid: number, replace: boolean): Promise<string> {
    setErr(null);
    setMsgs([...history, { role: "assistant", content: "" }]);
    setBusy(true);
    setStatus("Thinking…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = "";
    try {
      const apiMessages = buildApiMessages(history);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, think: thinkHard, ...(tools ? { tools } : {}) }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
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
          const data = s.slice(5).trim();
          if (data === "[DONE]" || !data) continue;
          try {
            const obj = JSON.parse(data);
            // Out-of-band status update (no `choices`): show what he's doing.
            if (obj.status?.label) {
              setStatus(obj.status.label);
              continue;
            }
            const delta = obj.choices?.[0]?.delta?.content;
            if (delta) {
              if (acc === "") setStatus(null); // first real token — drop the status line
              acc += delta;
              setMsgs((m) => {
                const c = [...m];
                c[c.length - 1] = { role: "assistant", content: acc };
                return c;
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (acc) {
        if (replace) void updateLastAssistant(cid, acc);
        else void appendMessage(cid, "assistant", acc);
      }
    } catch (e) {
      const aborted = (e as { name?: string })?.name === "AbortError";
      if (aborted) {
        // Stopped by the user — keep whatever streamed, persist the partial reply.
        if (acc) {
          if (replace) void updateLastAssistant(cid, acc);
          else void appendMessage(cid, "assistant", acc);
        } else {
          setMsgs((m) => m.slice(0, -1));
        }
      } else {
        setErr(e instanceof Error ? e.message : String(e));
        setMsgs((m) => m.slice(0, -1));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStatus(null);
    }
    return acc;
  }

  async function send(text: string, image?: string | null): Promise<string> {
    const q = text.trim();
    if ((!q && !image) || busy) return "";
    setInput("");
    setPendingImage(null);

    // Ensure a persisted chat exists.
    if (chatIdRef.current == null) {
      const { id } = await createChat(q || "Image");
      chatIdRef.current = id;
      window.history.replaceState({}, "", `/chat/${id}`);
    }
    const cid = chatIdRef.current;

    const userMsg: Msg = { role: "user", content: q, image: image ?? undefined, hasImage: !!image };
    void appendMessage(cid, "user", q || "[image]", !!image, image ?? null);
    return streamAssistant([...msgs, userMsg], cid, false);
  }

  // Regenerate the last reply: drop trailing assistant turn(s), re-stream from the
  // last user message, and overwrite the stored assistant row.
  async function regenerate() {
    if (busy || chatIdRef.current == null) return;
    const h = [...msgs];
    while (h.length && h[h.length - 1].role === "assistant") h.pop();
    if (!h.length) return;
    await streamAssistant(h, chatIdRef.current, true);
  }

  async function copyMsg(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  useEffect(() => {
    if (initialQ && !sent.current && initialMessages.length === 0) {
      sent.current = true;
      send(initialQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  }

  function toggleDictation() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      // iOS Safari: no in-app recognition — focus the field so the keyboard mic works.
      inputRef.current?.focus();
      return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setInput(txt);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
    setListening(true);
    r.start();
  }

  const hasText = input.trim().length > 0;
  const canSend = hasText || !!pendingImage;

  return (
    <main className="flex flex-col h-dvh overflow-hidden max-w-2xl mx-auto bg-bg">
      <header className="relative flex items-center px-3 pt-4 pb-3 border-b border-border shrink-0">
        <MenuButton />
        <h1 className="absolute left-1/2 -translate-x-1/2 text-xl font-bold italic tracking-tight bg-gradient-to-b from-bone to-bone-mute bg-clip-text text-transparent">
          Nillad
        </h1>
        <button
          onClick={() => setVoiceMode(true)}
          aria-label="Voice mode"
          className="ml-auto z-10 w-9 h-9 grid place-items-center rounded-full text-bone-dim hover:text-bone active:opacity-60 transition"
        >
          <Volume2 size={20} />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        {msgs.length === 0 && !busy && (
          <p className="text-center text-sm text-bone-mute py-10">Ask Nillad anything.</p>
        )}
        <div className="space-y-2.5">
          {msgs.map((m, i) => {
            const me = m.role === "user";
            const isLast = i === msgs.length - 1;
            const streaming = busy && isLast && m.role === "assistant";
            return (
              <div key={i} className={`flex flex-col ${me ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[15px] leading-snug break-words ${
                    me
                      ? "bubble-stroke-gradient text-bone whitespace-pre-wrap"
                      : "bubble-stroke-muted text-bone"
                  }`}
                >
                  {m.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt="" className="rounded-lg mb-2 max-h-48 w-auto" />
                  )}
                  {!m.image && m.hasImage && (
                    <span className="flex items-center gap-1 text-bone-mute text-xs mb-1">
                      <ImageIcon size={12} /> image
                    </span>
                  )}
                  {me ? (
                    m.content
                  ) : m.content ? (
                    <Markdown>{m.content}</Markdown>
                  ) : streaming ? (
                    <span className="flex items-center gap-2 text-bone-mute text-[13px] italic">
                      <Loader2 size={14} className="animate-spin shrink-0" />
                      <span className="animate-pulse">{status || "Thinking…"}</span>
                    </span>
                  ) : (
                    ""
                  )}
                </div>

                {!me && m.content && !streaming && (
                  <div className="flex items-center gap-1.5 mt-1.5 ml-1">
                    <button
                      onClick={() => copyMsg(m.content, i)}
                      aria-label="Copy"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-bone-dim bg-surface-2/60 hover:text-bone hover:bg-surface-2 active:opacity-60 transition"
                    >
                      {copiedIdx === i ? <Check size={14} className="text-periwinkle" /> : <Copy size={14} />}
                      {copiedIdx === i ? "Copied" : "Copy"}
                    </button>
                    {isLast && !busy && (
                      <button
                        onClick={regenerate}
                        aria-label="Retry"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-bone-dim bg-surface-2/60 hover:text-bone hover:bg-surface-2 active:opacity-60 transition"
                      >
                        <RotateCw size={14} /> Retry
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {err && <p className="text-xs text-warmred font-mono text-center mt-4 px-4">{err}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) send(input, pendingImage);
          else inputRef.current?.focus();
        }}
        className="shrink-0 px-3 pt-2 bg-bg"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.6rem)" }}
      >
        {pendingImage && (
          <div className="max-w-2xl mx-auto mb-2 flex">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingImage} alt="" className="h-16 w-16 object-cover rounded-lg border border-border" />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                aria-label="Remove image"
                className="absolute -top-2 -right-2 w-5 h-5 grid place-items-center rounded-full bg-surface-2 border border-border text-bone-dim"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 gradient-pill pl-1.5 pr-1.5 py-1.5">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach image"
            className="w-9 h-9 grid place-items-center rounded-full text-bone-dim hover:text-bone active:opacity-60 shrink-0"
          >
            <Plus size={20} />
          </button>
          <button
            type="button"
            onClick={() => setThinkHard((v) => !v)}
            aria-label="Think harder"
            aria-pressed={thinkHard}
            title={thinkHard ? "Thinking harder — tap to turn off" : "Think harder (slower, deeper)"}
            className={`w-9 h-9 grid place-items-center rounded-full shrink-0 transition ${
              thinkHard ? "gradient-fill text-bone" : "text-bone-dim hover:text-bone active:opacity-60"
            }`}
          >
            <Brain size={18} />
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? "Listening…" : thinkHard ? "Think harder is on…" : "How can I help?"}
            enterKeyHint="send"
            className="flex-1 bg-transparent outline-none text-bone placeholder:text-bone-mute italic px-1 min-w-0"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop"
              className="w-9 h-9 grid place-items-center rounded-full shrink-0 gradient-fill text-bone"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : canSend ? (
            <button
              type="submit"
              aria-label="Send"
              className="w-9 h-9 grid place-items-center rounded-full shrink-0 gradient-fill text-bone"
            >
              <ArrowUp size={18} />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleDictation}
              aria-label="Dictate"
              className={`w-9 h-9 grid place-items-center rounded-full shrink-0 transition ${
                listening ? "gradient-fill text-bone animate-pulse" : "text-bone-dim hover:text-bone"
              }`}
            >
              <Mic size={18} />
            </button>
          )}
        </div>
      </form>

      {voiceMode && (
        <VoiceMode
          initialMessages={msgs.map((m) => ({ role: m.role, content: m.content }))}
          onClose={() => setVoiceMode(false)}
        />
      )}
    </main>
  );
}
