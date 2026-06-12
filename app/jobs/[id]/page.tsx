import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getJob, formatInvoiceText, pickBiller, BUSINESSES } from "@/lib/jobs";
import { PageHeader } from "@/components/page-header";
import { JobDetail, type ContactOption } from "./job-detail";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const data = getJob(jobId);
  if (!data) notFound();

  const db = getDb();
  const contacts = db
    .prepare(`SELECT id, name, phone FROM contacts WHERE archived_at IS NULL ORDER BY name LIMIT 200`)
    .all() as ContactOption[];

  // Pre-format each invoice's text server-side so the client can show it without a round-trip.
  const invoices = data.invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    total: inv.total,
    stripeUrl: inv.stripe_url,
    text: formatInvoiceText(inv, data.job, data.contact),
  }));

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Job" />
      <JobDetail
        job={data.job}
        items={data.items}
        contacts={contacts}
        contactName={data.contact?.name || null}
        contactPhone={data.contact?.phone || null}
        invoices={invoices}
        defaultBiller={pickBiller(data.job)}
        billers={[
          { key: "tps", name: BUSINESSES.tps.name },
          { key: "sharpline", name: BUSINESSES.sharpline.name },
        ]}
      />
    </main>
  );
}
