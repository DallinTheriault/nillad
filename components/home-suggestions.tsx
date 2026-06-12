"use client";

import { useRouter } from "next/navigation";
import type { Suggestion } from "@/lib/home-context";

// Context-aware prompts (lib/home-context.ts) rendered as gently-floating glassy
// chips so they feel alive rather than just sitting there — and they're laid out
// to read as "orbiting" once the black-hole brain lands behind them. Tapping
// opens chat pre-loaded with the prompt's query.
export function HomeSuggestions({ suggestions }: { suggestions: Suggestion[] }) {
  const router = useRouter();
  const go = (q: string) => router.push(`/chat?q=${encodeURIComponent(q)}`);

  if (suggestions.length === 0) return null;

  return (
    <div className="px-5 flex flex-col items-center gap-2">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => go(s.query)}
          style={{ animationDelay: `${i * 0.7}s`, animationDuration: `${5 + i * 0.6}s` }}
          className="nf-float nf-glass max-w-[80%] rounded-full px-3.5 py-1.5 text-[12px] italic text-bone hover:text-white active:scale-95 transition"
        >
          {s.text}
        </button>
      ))}
    </div>
  );
}
