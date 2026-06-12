"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Mic, ArrowUp, AudioLines } from "lucide-react";
import { VoiceMode } from "@/app/chat/voice-mode";

// The always-present Nillad bar. Tap to type, + for attachments, mic for
// dictation. On submit it routes to /chat (native Nillad chat — wiring next).
export function ChatBar() {
  const path = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [flying, setFlying] = useState<{ c: string; dx: number; dy: number; rot: number; delay: number }[] | null>(null);

  // Hidden where a bottom typing surface already owns the screen.
  if (
    !path ||
    path.startsWith("/login") ||
    path.startsWith("/chat") ||
    path.startsWith("/terminal") ||
    path.startsWith("/invoice") ||
    /^\/messages\/\d+/.test(path)
  ) {
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }
    // From the home screen: flare the hole + send the message streaking up into
    // the swirl, then open the chat.
    if (path === "/" && !flying) {
      window.dispatchEvent(new CustomEvent("nillad-absorb"));
      // Each letter scatters and gets sucked up into the hole on its own path.
      const chars = q.split("").map((c) => ({
        c,
        dx: (Math.random() * 2 - 1) * 95,
        dy: -(44 + Math.random() * 18),
        rot: (Math.random() * 2 - 1) * 260,
        delay: Math.random() * 200,
      }));
      setFlying(chars);
      setText("");
      inputRef.current?.blur();
      window.setTimeout(() => router.push(`/chat?q=${encodeURIComponent(q)}`), 850);
      return;
    }
    router.push(`/chat?q=${encodeURIComponent(q)}`);
    setText("");
  }

  const hasText = text.trim().length > 0;

  return (
    <>
    {/* Each letter of the message scatters up into the black hole when you send from home */}
    {flying && (
      <div className="fixed left-1/2 z-30 pointer-events-none" style={{ bottom: "92px", transform: "translateX(-50%)" }}>
        <div className="flex text-[15px] italic font-medium text-bone whitespace-nowrap drop-shadow-[0_0_8px_rgba(98,92,200,0.7)]">
          {flying.map((L, i) => (
            <span
              key={i}
              className="nf-letter inline-block whitespace-pre"
              style={{ "--dx": `${L.dx}px`, "--dy": `${L.dy}vh`, "--rot": `${L.rot}deg`, animationDelay: `${L.delay}ms` } as React.CSSProperties}
            >
              {L.c === " " ? " " : L.c}
            </span>
          ))}
        </div>
      </div>
    )}
    <div
      className="fixed bottom-0 inset-x-0 z-20 px-3 pt-3 bg-gradient-to-t from-bg via-bg to-transparent"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.6rem)" }}
    >
      <form
        onSubmit={submit}
        className="max-w-2xl mx-auto flex items-center gap-1.5 gradient-pill pl-1.5 pr-1.5 py-1.5"
      >
        <button
          type="button"
          onClick={() => setVoiceMode(true)}
          aria-label="Voice mode"
          className="w-9 h-9 grid place-items-center rounded-full text-bone-dim hover:text-bone active:opacity-60 transition shrink-0"
        >
          <AudioLines size={19} />
        </button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="How can I help?"
          className="flex-1 bg-transparent outline-none text-bone placeholder:text-bone-mute italic px-1 min-w-0"
          enterKeyHint="send"
        />
        <button
          type="submit"
          aria-label={hasText ? "Send" : "Dictate"}
          className={`w-9 h-9 grid place-items-center rounded-full shrink-0 transition ${
            hasText
              ? "gradient-fill text-bone"
              : "text-bone-dim hover:text-bone active:opacity-60"
          }`}
        >
          {hasText ? <ArrowUp size={18} /> : <Mic size={18} />}
        </button>
      </form>
    </div>
    {voiceMode && <VoiceMode onClose={() => setVoiceMode(false)} />}
    </>
  );
}
