"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Check } from "lucide-react";
import { deleteChat } from "@/app/chat/actions";

// Tap-to-arm delete (so a stray tap on a phone can't nuke a chat): first tap
// turns it red, second tap within a couple seconds deletes.
export function ChatDeleteButton({ id }: { id: number }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 2500);
          return;
        }
        start(async () => {
          await deleteChat(id);
          router.refresh();
        });
      }}
      aria-label={armed ? "Confirm delete" : "Delete chat"}
      className={`shrink-0 self-center w-9 h-9 grid place-items-center rounded-full transition disabled:opacity-50 ${
        armed ? "text-warmred bg-warmred/10" : "text-bone-mute hover:text-warmred active:opacity-60"
      }`}
    >
      {armed ? <Check size={16} /> : <Trash2 size={15} />}
    </button>
  );
}
