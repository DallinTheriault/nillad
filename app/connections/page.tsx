import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import {
  providerById,
  summarize,
  type ConnectionView,
  type ConnKind,
} from "@/lib/connections";
import { ConnectionsShell } from "./connections-shell";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  kind: string;
  provider: string;
  label: string;
  status: string;
  config: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

export default async function ConnectionsPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, kind, provider, label, status, config, last_sync_at, last_error
       FROM connections ORDER BY created_at DESC LIMIT 300`,
    )
    .all() as Row[];

  // Build secret-free views for the client. `secret` is never selected above.
  const views: ConnectionView[] = rows.map((r) => {
    const provider = providerById(r.provider);
    let config: Record<string, string> = {};
    try {
      config = r.config ? (JSON.parse(r.config) as Record<string, string>) : {};
    } catch {
      /* corrupt config — show nothing rather than crash */
    }
    return {
      id: r.id,
      kind: (r.kind as ConnKind) || "other",
      provider: r.provider,
      providerName: provider?.name || r.provider,
      label: r.label,
      status: (r.status as ConnectionView["status"]) || "pending",
      summary: summarize(provider, config),
      needsDesktop: !!provider?.needsDesktop,
      last_sync_at: r.last_sync_at,
      last_error: r.last_error,
    };
  });

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Connections" />
      <ConnectionsShell connections={views} />
    </main>
  );
}
