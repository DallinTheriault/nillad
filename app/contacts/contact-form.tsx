"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createContact, updateContact, type ContactFields } from "./actions";

export type ContactFormData = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

export function ContactForm({ contact }: { contact?: ContactFormData }) {
  const router = useRouter();
  const editing = !!contact;
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [address, setAddress] = useState(contact?.address ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const fields: ContactFields = { name, phone, email, address, notes };
    startTransition(async () => {
      if (editing) {
        const r = await updateContact(contact!.id, fields);
        if (!r.ok) return setErr(r.error || "Failed to save.");
        router.push(`/contacts/${contact!.id}`);
      } else {
        const r = await createContact(fields);
        if (!r.ok) return setErr(r.error || "Failed to save.");
        router.push(`/contacts/${r.id}`);
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="Jane Doe"
          className={inputCls}
        />
      </Field>
      <Field label="Phone">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567"
          className={inputCls}
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@example.com"
          className={inputCls}
        />
      </Field>
      <Field label="Address">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St"
          className={inputCls}
        />
      </Field>
      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </Field>

      {err && <p className="text-xs text-warmred font-mono text-center">{err}</p>}

      <div className="flex items-center justify-between pt-2 gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={pending}
          className="text-bone-dim text-sm hover:text-bone transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || (!name.trim() && !phone.trim())}
          className="gradient-pill px-5 py-2 text-sm font-medium tracking-wide inline-flex items-center gap-1.5"
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          {pending ? "Saving…" : editing ? "Save changes" : "Create contact"}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
