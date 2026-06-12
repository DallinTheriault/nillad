import { PageHeader } from "@/components/page-header";
import { listSubscriptions, subscriptionSummary, upcomingRenewals } from "@/lib/subscriptions";
import { SubscriptionsShell } from "./subscriptions-shell";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const rows = listSubscriptions(false);
  const summary = subscriptionSummary();
  const upcoming = upcomingRenewals(30);

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Subscriptions" />
      <SubscriptionsShell rows={rows} summary={summary} upcoming={upcoming} />
    </main>
  );
}
