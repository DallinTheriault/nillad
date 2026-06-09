"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Plus, Mic, ArrowUp } from "lucide-react";

// The always-present Nillad bar. Tap to type, + for attachments, mic for
// dictation. On submit it routes to /chat (native Nillad chat — wiring next).
export function ChatBar() {
  const path = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  // Hidden where a bottom typing surface already owns the screen.
  if (
    !path ||
    path.startsWith("/login") ||
    path.startsWith("/chat") ||
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
    router.push(`/chat?q=${encodeURIComponent(q)}`);
    setText("");
  }

  const hasText = text.trim().length > 0;

  return (
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
          aria-label="Add attachment"
          className="w-9 h-9 grid place-items-center rounded-full text-bone-dim hover:text-bone active:opacity-60 transition shrink-0"
        >
          <Plus size={20} />
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
  );
}
