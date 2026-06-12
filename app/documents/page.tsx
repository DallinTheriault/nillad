import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { DocumentsShell, type DocMeta } from "./documents-shell";

export const dynamic = "force-dynamic";

export default function DocumentsPage() {
  const db = getDb();
  // Metadata only — full text loads on demand (getDocText) when a doc is opened.
  const rows = db
    .prepare(
      `SELECT id, filename, kind, bytes, pages, summary, source, created_at,
              (text IS NOT NULL AND length(text) > 0) AS has_text
       FROM documents ORDER BY created_at DESC, id DESC LIMIT 300`,
    )
    .all() as DocMeta[];

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Documents" />
      <DocumentsShell rows={rows} />
    </main>
  );
}
