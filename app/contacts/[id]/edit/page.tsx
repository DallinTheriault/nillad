import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/lib/db";
import { ContactForm, type ContactFormData } from "../../contact-form";

export const dynamic = "force-dynamic";

export default async function EditContactPage({
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
      `SELECT id, name, phone, email, address, notes
       FROM contacts WHERE id = ? AND archived_at IS NULL`,
    )
    .get(contactId) as ContactFormData | undefined;
  if (!contact) notFound();

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <header className="border-b border-border bg-bg px-4 py-4">
        <Link
          href={`/contacts/${contact.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-bone-dim hover:text-bone mb-2"
        >
          <ArrowLeft size={12} /> Back
        </Link>
        <div className="text-[10px] uppercase tracking-[0.22em] text-bone-mute font-mono mb-1">
          NF · Contact
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-bone">
          Edit contact
        </h1>
      </header>

      <div className="px-4 py-4">
        <ContactForm contact={contact} />
      </div>
    </main>
  );
}
