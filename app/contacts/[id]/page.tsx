import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Phone as PhoneIcon,
  Mail,
  MapPin,
  Pencil,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import { getDb } from "@/lib/db";
import { fmtPhoneDisplay } from "@/lib/phone";
import { DeleteContactButton } from "./delete-contact-button";

export const dynamic = "force-dynamic";

type Contact = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
};

type ThreadPeek = {
  id: number;
  last_message_preview: string | null;
  last_message_at: string | null;
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + (d.includes("T") ? "" : "Z")).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contactId = Number(id);
  if (!Number.isFinite(contactId)) notFound();

  const db = getDb();
  const contact = db
    .prepare(
      `SELECT id, name, phone, email, address, notes, created_at, updated_at
       FROM contacts WHERE id = ? AND archived_at IS NULL`,
    )
    .get(contactId) as Contact | undefined;
  if (!contact) notFound();

  // Soft-link: find the SMS thread for this contact's phone, if any.
  const thread = contact.phone
    ? (db
        .prepare(
          `SELECT id, last_message_preview, last_message_at
           FROM sms_threads
           WHERE contact_phone = ? AND archived_at IS NULL`,
        )
        .get(contact.phone) as ThreadPeek | undefined)
    : undefined;

  const title = contact.name || fmtPhoneDisplay(contact.phone) || "Contact";

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <header className="border-b border-border bg-bg px-4 py-4">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-xs text-bone-dim hover:text-bone mb-2"
        >
          <ArrowLeft size={12} /> Contacts
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-bone-mute font-mono mb-1">
              NF · Contact
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-bone truncate">
              {title}
            </h1>
            {contact.phone && (
              <p className="num text-sm text-bone-dim mt-1 font-mono">
                {fmtPhoneDisplay(contact.phone)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/contacts/${contact.id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-bone-dim hover:text-bone hover:border-border-strong text-xs transition"
            >
              <Pencil size={12} /> Edit
            </Link>
          </div>
        </div>
      </header>

      {/* Quick actions */}
      {contact.phone && (
        <div className="px-4 pt-4 flex flex-wrap items-center gap-2">
          <a
            href={`tel:${contact.phone}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-bone hover:border-border-strong text-sm transition"
          >
            <PhoneIcon size={14} /> Call
          </a>
          {thread && (
            <Link
              href={`/messages/${thread.id}`}
              className="gradient-pill inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium"
            >
              <MessageSquare size={14} /> Open texts
            </Link>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-bone hover:border-border-strong text-sm transition"
            >
              <Mail size={14} /> Email
            </a>
          )}
        </div>
      )}

      {/* Details */}
      <section className="px-4 py-4">
        <div className="rounded-xl border border-border bg-surface/40 divide-y divide-border">
          <Row icon={PhoneIcon} label="Phone" value={fmtPhoneDisplay(contact.phone) || "—"} mono />
          <Row icon={Mail} label="Email" value={contact.email || "—"} />
          <Row icon={MapPin} label="Address" value={contact.address || "—"} />
          <Row label="Created" value={fmtDate(contact.created_at)} />
          <Row label="Updated" value={fmtDate(contact.updated_at ?? contact.created_at)} />
        </div>

        {contact.notes && (
          <div className="mt-4 rounded-xl border border-border bg-surface/40 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono mb-2">
              Notes
            </div>
            <p className="text-sm text-bone whitespace-pre-wrap break-words">
              {contact.notes}
            </p>
          </div>
        )}

        {/* Linked conversation peek */}
        {thread && (
          <Link
            href={`/messages/${thread.id}`}
            className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-surface/40 px-4 py-3 hover:bg-surface transition-colors"
          >
            <MessageSquare size={16} className="text-periwinkle shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono uppercase tracking-wider text-bone-mute mb-0.5">
                Conversation
              </div>
              <div className="text-sm text-bone-dim truncate">
                {thread.last_message_preview || "Open conversation"}
              </div>
            </div>
            <ChevronRight size={16} className="text-bone-mute shrink-0" />
          </Link>
        )}

        <div className="mt-6">
          <DeleteContactButton contactId={contact.id} />
        </div>
      </section>
    </main>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon?: typeof PhoneIcon;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="px-4 py-3 grid grid-cols-3 gap-3 items-center">
      <dt className="text-xs text-bone-mute flex items-center gap-1.5 font-mono uppercase tracking-wider">
        {Icon && <Icon size={12} />}
        {label}
      </dt>
      <dd className={`col-span-2 text-sm text-bone break-all ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
