import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewContactForm } from "./form";

export default function NewContactPage() {
  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <header className="border-b border-border bg-bg px-4 py-4">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-xs text-bone-dim hover:text-bone mb-2"
        >
          <ArrowLeft size={12} /> Contacts
        </Link>
        <div className="text-[10px] uppercase tracking-[0.22em] text-bone-mute font-mono mb-1">
          NF · People
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-bone">
          New contact
        </h1>
      </header>

      <div className="px-4 py-4">
        <NewContactForm />
      </div>
    </main>
  );
}
