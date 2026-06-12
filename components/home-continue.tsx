"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type { RecentChat } from "@/lib/home-context";

// "Want to continue on…" — a horizontal row of recent conversations to resume.
// Tapping reopens that chat (/chat/[id]).
export function HomeContinue({ chats }: { chats: RecentChat[] }) {
  if (!chats.length) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono mb-2 text-center">Continue</div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: "none" }}>
        {chats.map((c) => (
          <Link
            key={c.id}
            href={`/chat/${c.id}`}
            className="nf-glass shrink-0 w-[140px] rounded-xl px-3 py-1.5 active:opacity-70 transition-opacity"
          >
            <div className="flex items-center gap-1.5 text-bone text-[12px] font-medium truncate">
              <MessageCircle size={11} className="text-periwinkle-soft shrink-0" />
              <span className="truncate">{c.title}</span>
            </div>
            {c.when && <div className="text-[10px] text-bone-mute mt-0.5">{c.when}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
