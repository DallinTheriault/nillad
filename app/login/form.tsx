"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login } from "./actions";

export function LoginForm() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/messages";

  return (
    <div className="relative w-full max-w-xs">
      <div className="text-center mb-8">
        <div className="text-[10px] uppercase tracking-[0.22em] text-bone-mute font-mono mb-2">
          Nillad&apos;s Field
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-bone">
          Sign in
        </h1>
        <p className="text-xs text-bone-dim mt-2">
          Enter your PIN to continue.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            const r = await login(fd);
            if (r.ok) router.replace(next);
            else setError(r.error || "Sign in failed.");
          });
        }}
        className="space-y-3"
      >
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="w-full text-center text-lg tracking-[0.4em] font-mono rounded-xl bg-surface/85 backdrop-blur border border-border px-4 py-3 text-bone outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          autoFocus
        />
        <button
          type="submit"
          disabled={pending || !pin}
          className="gradient-pill w-full py-3 font-semibold tracking-wide"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {error && (
          <p className="text-center text-xs text-warmred font-mono">{error}</p>
        )}
      </form>
    </div>
  );
}
