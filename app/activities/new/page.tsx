import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ActivityForm } from "../activity-form";

export default function NewActivityPage() {
  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <header className="border-b border-border bg-bg px-4 py-4">
        <Link
          href="/activities"
          className="inline-flex items-center gap-1.5 text-xs text-bone-dim hover:text-bone mb-2"
        >
          <ArrowLeft size={12} /> Activities
        </Link>
        <div className="text-[10px] uppercase tracking-[0.22em] text-bone-mute font-mono mb-1">
          NF · Context
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-bone">
          New activity
        </h1>
      </header>

      <div className="px-4 py-4">
        <ActivityForm />
      </div>
    </main>
  );
}
