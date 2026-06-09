"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, AlertTriangle } from "lucide-react";
import { archiveContact } from "../actions";

// Soft-delete (sets archived_at). Any linked SMS thread stays intact —
// only the contact disappears from default views.
export function DeleteContactButton({ contactId }: { contactId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleArchive() {
    startTransition(async () => {
      await archiveContact(contactId);
      router.push("/contacts");
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <div className="rounded-xl border border-warmred/40 bg-warmred/[0.06] px-4 py-3 flex items-start gap-2.5">
        <AlertTriangle size={15} className="text-warmred shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-bone font-medium">Delete this contact?</p>
          <p className="text-xs text-bone-dim mt-0.5 leading-relaxed">
            It’s hidden from your views. Any linked SMS thread stays intact.
          </p>
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={handleArchive}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-warmred text-bone text-sm font-medium hover:bg-warmred-soft transition disabled:opacity-50"
            >
              {pending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="text-bone-dim text-sm hover:text-bone transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft transition"
    >
      <Trash2 size={14} /> Delete contact
    </button>
  );
}
