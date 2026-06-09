"use client";

import { useRouter } from "next/navigation";
import type { Suggestion } from "@/lib/home-context";

// Tappable, context-aware prompts under the graph — derived from your most
// recent activity and soonest reminder (see lib/home-context.ts). Tapping one
// opens chat pre-loaded with its query so Nillad acts on it immediately.
export function HomeSuggestions({ suggestions }: { suggestions: Suggestion[] }) {
  const router = useRouter();
  const go = (q: string) => router.push(`/chat?q=${encodeURIComponent(q)}`);

  if (suggestions.length === 0) return null;

  return (
    <div className="px-6 space-y-4 text-center">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => go(s.query)}
          className={
            i === 0
              ? "block w-full text-balance text-lg italic font-medium text-bone leading-snug active:opacity-60 transition"
              : "block w-full text-balance text-base italic text-bone-dim leading-snug active:opacity-60 transition"
          }
        >
          {s.text}
        </button>
      ))}
    </div>
  );
}
