"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createActivity, updateActivity } from "./actions";

export type ActivityFormData = {
  id: number;
  title: string | null;
  category: string | null;
  notes: string | null;
};

export function ActivityForm({ activity }: { activity?: ActivityFormData }) {
  const router = useRouter();
  const editing = !!activity;
  const [title, setTitle] = useState(activity?.title ?? "");
  const [category, setCategory] = useState(activity?.category ?? "");
  const [notes, setNotes] = useState(activity?.notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const fields = { title, category, notes };
    startTransition(async () => {
      if (editing) {
        const r = await updateActivity(activity!.id, fields);
        if (!r.ok) return setErr(r.error || "Failed to save.");
        router.push(`/activities/${activity!.id}`);
      } else {
        const r = await createActivity(fields);
        if (!r.ok) return setErr(r.error || "Failed to save.");
        router.push(`/activities/${r.id}`);
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label="Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          placeholder="Faceless YouTube channel"
          className={inputCls}
        />
      </Field>
      <Field label="Category (optional)">
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="side project · work · errand…"
          className={inputCls}
        />
      </Field>
      <Field label="Context notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="What this is, where it stands, anything Nillad should know to help."
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
          disabled={pending || !title.trim()}
          className="gradient-pill px-5 py-2 text-sm font-medium tracking-wide inline-flex items-center gap-1.5"
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          {pending ? "Saving…" : editing ? "Save changes" : "Create activity"}
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
