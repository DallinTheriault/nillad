// Recurring subscriptions / fixed costs. The counterpart to one-off expenses:
// these repeat, so the value of this module is normalizing every cadence to a
// single monthly + annual burn number and surfacing what renews soon. Read-only
// helpers here; mutations live in app/subscriptions/actions.ts.

import { getDb } from "@/lib/db";

export const CADENCES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const SUB_CATEGORIES = [
  "software",
  "email",
  "hosting",
  "domain",
  "phone",
  "insurance",
  "equipment",
  "marketing",
  "banking",
  "other",
] as const;

export type SubScope = "business" | "personal";

export type Subscription = {
  id: number;
  name: string;
  vendor: string | null;
  amount: number;
  cadence: Cadence;
  category: string | null;
  scope: string;
  next_renewal: string | null;
  active: number;
  notes: string | null;
};

// Normalize a per-cycle amount to its monthly-equivalent cost.
export function monthlyEquivalent(amount: number, cadence: string): number {
  const a = amount || 0;
  switch (cadence) {
    case "weekly":
      return (a * 52) / 12;
    case "quarterly":
      return a / 3;
    case "yearly":
      return a / 12;
    case "monthly":
    default:
      return a;
  }
}

export function listSubscriptions(activeOnly = false, scope?: SubScope): Subscription[] {
  const db = getDb();
  const conds: string[] = [];
  if (activeOnly) conds.push("active=1");
  if (scope) conds.push("scope=?");
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT id, name, vendor, amount, cadence, category, scope, next_renewal, active, notes
       FROM subscriptions ${where}
       ORDER BY active DESC, next_renewal IS NULL, next_renewal ASC, name ASC`,
    )
    .all(...(scope ? [scope] : [])) as Subscription[];
}

export type SubSummary = { monthlyBurn: number; annualBurn: number; count: number };

// Total monthly + annual burn across ACTIVE subscriptions (optionally one scope).
export function subscriptionSummary(scope?: SubScope): SubSummary {
  const subs = listSubscriptions(true, scope);
  const monthlyBurn = subs.reduce((s, x) => s + monthlyEquivalent(x.amount, x.cadence), 0);
  return {
    monthlyBurn: +monthlyBurn.toFixed(2),
    annualBurn: +(monthlyBurn * 12).toFixed(2),
    count: subs.length,
  };
}

// Active subscriptions renewing within `days` (default 30), soonest first.
export function upcomingRenewals(days = 30, scope?: SubScope): Subscription[] {
  const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return listSubscriptions(true, scope)
    .filter((s) => s.next_renewal && s.next_renewal >= today && s.next_renewal <= cutoff)
    .sort((a, b) => (a.next_renewal! < b.next_renewal! ? -1 : 1));
}

// Monthly burn only (used by the dashboards). Cheap + defensive.
export function monthlyBurn(scope?: SubScope): number {
  try {
    return subscriptionSummary(scope).monthlyBurn;
  } catch {
    return 0;
  }
}
