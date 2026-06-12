import { PageHeader } from "@/components/page-header";
import { TerminalShell } from "./terminal-shell";

export const dynamic = "force-dynamic";

export default function TerminalPage() {
  return (
    <main className="flex flex-col h-dvh max-w-2xl mx-auto">
      <PageHeader title="Terminal" />
      <TerminalShell />
    </main>
  );
}
