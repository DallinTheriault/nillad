import { notFound } from "next/navigation";
import { getInvoice, businessFor, money } from "@/lib/jobs";
import { InvoiceToolbar } from "./print-button";

export const dynamic = "force-dynamic";

type Item = { description: string; qty: number; unit_price: number };

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getInvoice(Number(id));
  if (!data) notFound();
  const { invoice, job, contact } = data;
  const biz = businessFor(invoice.biller);
  const items: Item[] = JSON.parse(invoice.items_json || "[]");
  const label = invoice.kind === "estimate" ? "ESTIMATE" : "INVOICE";
  const serviceDate = job.scheduled_date || invoice.issued_on || "";

  return (
    <>
      <InvoiceToolbar />
      <div className="invoice-wrap">
        <style>{PRINT_CSS}</style>
        <div className="inv" style={{ "--accent": biz.accent } as React.CSSProperties}>
          <div className="accent-bar" />

          {/* Header */}
          <header className="inv-head">
            <div className="biz">
              <div className="biz-name">{biz.name}</div>
              {biz.dba && <div className="biz-dba">{biz.dba}</div>}
              <div className="biz-line">{biz.address}</div>
              <div className="biz-line">{biz.phone} · {biz.email}</div>
            </div>
            <div className="meta">
              <div className="label">{label}</div>
              <table className="meta-tbl">
                <tbody>
                  <tr><td>{label === "ESTIMATE" ? "Estimate #" : "Invoice #"}</td><td>{invoice.number}</td></tr>
                  <tr><td>Date</td><td>{fmtDate(invoice.issued_on)}</td></tr>
                  {invoice.due_on && <tr><td>Due</td><td>{fmtDate(invoice.due_on)}</td></tr>}
                </tbody>
              </table>
            </div>
          </header>

          {/* Parties */}
          <section className="parties">
            <div className="party">
              <div className="party-h">BILL TO</div>
              <div className="party-name">{contact?.name || job.client || "—"}</div>
              {contact?.email && <div className="party-line">{contact.email}</div>}
              {contact?.phone && <div className="party-line">{contact.phone}</div>}
            </div>
            <div className="party">
              <div className="party-h">SERVICE LOCATION</div>
              <div className="party-name">{job.title || "—"}</div>
              {job.location && <div className="party-line">{job.location}</div>}
              {serviceDate && <div className="party-line">Service date: {fmtDate(serviceDate)}</div>}
            </div>
          </section>

          {/* Line items */}
          <table className="items">
            <thead>
              <tr>
                <th className="c-num">#</th>
                <th className="c-desc">DESCRIPTION</th>
                <th className="c-qty">QTY</th>
                <th className="c-unit">UNIT</th>
                <th className="c-amt">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="c-num">{i + 1}</td>
                  <td className="c-desc">{it.description}</td>
                  <td className="c-qty">{it.qty}</td>
                  <td className="c-unit">{money(it.unit_price)}</td>
                  <td className="c-amt">{money(it.qty * it.unit_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="totals">
            <div className="tot-row"><span>Subtotal</span><span>{money(invoice.subtotal)}</span></div>
            <div className="tot-row total-due"><span>TOTAL DUE</span><span>{money(invoice.total)}</span></div>
          </div>

          {/* Footer */}
          <footer className="pay">
            <div className="pay-h">PAYMENT</div>
            <div>Venmo: <strong>{biz.venmo}</strong></div>
            {invoice.kind === "invoice" && invoice.stripe_url && (
              <div className="paycard">
                Pay by card: <a href={invoice.stripe_url}>{invoice.stripe_url}</a>
              </div>
            )}
            <div className="muted">Questions? {biz.phone} · {biz.email}</div>
            {job.scope && <div className="scope">Scope: {job.scope}</div>}
          </footer>
        </div>
      </div>
    </>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "";
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const PRINT_CSS = `
.invoice-wrap { background:#5b5b66; min-height:100dvh; padding:18px; display:flex; justify-content:center; }
.inv { width:100%; max-width:760px; background:#fff; color:#1a1a22; border-radius:10px; overflow:hidden;
  box-shadow:0 10px 40px rgba(0,0,0,.35); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
.inv .accent-bar { height:8px; background:var(--accent); }
.inv-head { display:flex; justify-content:space-between; gap:24px; padding:28px 32px 18px; }
.biz-name { font-size:21px; font-weight:800; color:var(--accent); letter-spacing:-.01em; }
.biz-dba { font-size:11px; color:#6b7280; margin-top:1px; }
.biz-line { font-size:12.5px; color:#374151; margin-top:4px; }
.meta { text-align:right; min-width:210px; }
.meta .label { font-size:26px; font-weight:800; letter-spacing:.12em; color:#1a1a22; }
.meta-tbl { margin-left:auto; margin-top:8px; font-size:12.5px; border-collapse:collapse; }
.meta-tbl td { padding:2px 0 2px 14px; }
.meta-tbl td:first-child { color:#6b7280; text-align:right; }
.meta-tbl td:last-child { font-weight:600; text-align:right; }
.parties { display:flex; gap:24px; padding:14px 32px 6px; }
.party { flex:1; }
.party-h { font-size:10px; font-weight:700; letter-spacing:.14em; color:#fff; background:var(--accent); display:inline-block; padding:2px 8px; border-radius:3px; }
.party-name { font-weight:700; margin-top:7px; font-size:14px; }
.party-line { font-size:12.5px; color:#374151; margin-top:2px; }
.items { width:100%; border-collapse:collapse; margin:18px 0 0; }
.items thead th { font-size:10.5px; letter-spacing:.08em; text-align:left; color:#fff; background:var(--accent); padding:8px 10px; }
.items th.c-num { width:34px; text-align:center; }
.items th.c-qty, .items th.c-unit, .items th.c-amt { text-align:right; white-space:nowrap; }
.items td { padding:10px; font-size:13px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
.items td.c-num { text-align:center; color:#9ca3af; }
.items td.c-qty, .items td.c-unit, .items td.c-amt { text-align:right; white-space:nowrap; }
.items td.c-amt { font-weight:600; }
.totals { margin:14px 32px 0; margin-left:auto; width:280px; padding:0 32px 0 0; }
.tot-row { display:flex; justify-content:space-between; font-size:13px; padding:6px 0; color:#374151; }
.tot-row.total-due { margin-top:4px; padding-top:10px; border-top:2px solid var(--accent); font-size:17px; font-weight:800; color:#1a1a22; }
.pay { margin:26px 32px 30px; padding-top:16px; border-top:1px solid #e5e7eb; font-size:12.5px; color:#374151; }
.pay-h { font-size:10px; font-weight:700; letter-spacing:.14em; color:#6b7280; margin-bottom:5px; }
.pay .muted { color:#6b7280; margin-top:3px; }
.pay .paycard { margin-top:4px; }
.pay .paycard a { color:var(--accent); word-break:break-all; }
.pay .scope { color:#6b7280; margin-top:8px; font-style:italic; }
@media print {
  .no-print { display:none !important; }
  .invoice-wrap { background:#fff; padding:0; }
  .inv { box-shadow:none; border-radius:0; max-width:none; }
  @page { margin:14mm; }
}
`;
