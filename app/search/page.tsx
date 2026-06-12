import { PageHeader } from "@/components/page-header";
import { SearchShell } from "./search-shell";

export const dynamic = "force-dynamic";

export default function SearchPage() {
  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Search" />
      <SearchShell />
    </main>
  );
}
