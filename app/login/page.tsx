import { Suspense } from "react";
import { LoginForm } from "./form";
import { LowPolyBg } from "@/components/low-poly-bg";

export default function LoginPage() {
  return (
    <main className="relative min-h-dvh grid place-items-center px-6 bg-bg overflow-hidden">
      <LowPolyBg
        className="absolute inset-0 w-full h-full opacity-95"
        seed={11}
        rows={10}
        cols={16}
        darken={0.0}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.62) 65%, rgba(0,0,0,0.85) 100%)",
        }}
      />
      <Suspense
        fallback={
          <div className="relative text-bone-mute text-sm font-mono">
            loading…
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
