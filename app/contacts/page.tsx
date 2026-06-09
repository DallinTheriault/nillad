import Link from "next/link";
import { Users, Plus, Search, Phone as PhoneIcon, Mail } from "lucide-react";
import { getDb } from "@/lib/db";
import { fmtPhoneDisplay } from "@/lib/phone";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

type ContactRow = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  updated_at: string | null;
  created_at: string;
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const db = getDb();

  let rows: ContactRow[];
  if (term) {
    const like = `%${term}%`;
    rows = db
      .prepare(
        `SELECT id, name, phone, email, address, updated_at, created_at
         FROM contacts
         WHERE archived_at IS NULL
           AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)
         ORDER BY updated_at DESC
         LIMIT 200`,
      )
      .all(like, like, like) as ContactRow[];
  } else {
    rows = db
      .prepare(
        `SELECT id, name, phone, email, address, updated_at, created_at
         FROM contacts
         WHERE archived_at IS NULL
         ORDER BY updated_at DESC
         LIMIT 200`,
      )
      .all() as ContactRow[];
  }

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader
        title="Contacts"
        action={
          <Link
            href="/contacts/new"
            aria-label="Add contact"
            className="w-9 h-9 grid place-items-center rounded-full text-bone hover:bg-surface-2 transition"
          >
            <Plus size={22} />
          </Link>
        }
      />

      <div className="px-4 pb-3">
        <form className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-bone-mute pointer-events-none"
          />
          <input
            type="text"
            name="q"
            defaultValue={term}
            placeholder="Search name, phone, email…"
            className="w-full rounded-lg bg-surface border border-border pl-9 pr-3 py-2 text-sm text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-surface border border-border flex items-center justify-center mb-3">
            <Users size={20} className="text-bone-dim" />
          </div>
          <div className="text-sm font-medium text-bone">
            {term ? "No matching contacts" : "No contacts yet"}
          </div>
          <p className="text-xs text-bone-dim mt-1 max-w-[32ch] mx-auto">
            {term ? "Try clearing your search." : "Add your first contact with the button above."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((c) => {
            const title = c.name || fmtPhoneDisplay(c.phone) || "—";
            return (
              <li key={c.id}>
                <Link
                  href={`/contacts/${c.id}`}
                  className="flex items-start gap-3 px-4 py-3.5 active:bg-surface hover:bg-surface/70 transition-colors"
                >
                  <span className="mt-0.5 w-9 h-9 shrink-0 rounded-full bg-surface-2 border border-border grid place-items-center text-bone-dim text-sm font-medium uppercase">
                    {(c.name?.trim()?.[0] ?? "#")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-bone truncate">{title}</div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] font-mono text-bone-mute">
                      {c.phone && (
                        <span className="inline-flex items-center gap-1">
                          <PhoneIcon size={11} />
                          {fmtPhoneDisplay(c.phone)}
                        </span>
                      )}
                      {c.email && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Mail size={11} />
                          <span className="truncate">{c.email}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
