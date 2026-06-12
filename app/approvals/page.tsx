import { PageHeader } from "@/components/page-header";
import { listPendingActions } from "@/lib/automations";
import { ApprovalsShell } from "./approvals-shell";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const actions = listPendingActions();
  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Approvals" />
      <ApprovalsShell actions={actions} />
    </main>
  );
}
