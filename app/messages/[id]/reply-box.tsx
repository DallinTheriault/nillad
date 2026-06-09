"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { sendReply } from "./actions";

export function ReplyBox({
  threadId,
  isStopped,
}: {
  threadId: number;
  isStopped: boolean;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (isStopped) {
    return (
      <div className="border-t border-border px-4 py-3 bg-surface mb-14">
        <p className="text-xs text-bone-dim">
          This contact has opted out (STOP). You can&apos;t send to them until they
          reply START.
        </p>
      </div>
    );
  }

  return (
    <form
      className="border-t border-border px-3 py-2 flex items-end gap-2 bg-bg relative shrink-0"
      style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const text = body;
        startTransition(async () => {
          const r = await sendReply(threadId, text);
          if (r.ok) {
            setBody("");
            router.refresh(); // show the sent message immediately, don't wait for the poll
          } else setError(r.error || "send failed");
        });
      }}
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message"
        rows={1}
        maxLength={1600}
        className="flex-1 resize-none rounded-2xl bg-surface border border-border px-3 py-2 text-base text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle max-h-32"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !pending && body.trim()) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <button
        type="submit"
        disabled={pending || !body.trim()}
        className="shrink-0 w-9 h-9 rounded-full grid place-items-center disabled:opacity-30 transition"
        style={{
          background: "linear-gradient(65deg, #625CC8 0%, #D52F31 100%)",
        }}
        aria-label="Send"
      >
        <Send size={16} className="text-white" />
      </button>
      {error && (
        <p className="absolute -top-7 left-3 text-[11px] text-warmred font-mono">
          {error}
        </p>
      )}
    </form>
  );
}
