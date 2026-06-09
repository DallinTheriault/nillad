import { MenuButton } from "@/components/menu-button";
import { NilladGraph } from "@/components/nillad-graph";
import { HomeSuggestions } from "@/components/home-suggestions";
import { getDb } from "@/lib/db";
import { getHomeSuggestions } from "@/lib/home-context";

export const dynamic = "force-dynamic";

export default function Home() {
  let recent: string[] = [];
  try {
    const db = getDb();
    recent = (
      db
        .prepare(
          `SELECT title FROM activities WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 6`,
        )
        .all() as { title: string }[]
    ).map((r) => r.title);
  } catch {
    recent = [];
  }
  const suggestions = getHomeSuggestions();

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-28 flex flex-col overflow-x-clip">
      <header className="px-4 pt-4 flex items-center">
        <MenuButton />
        <h1 className="flex-1 text-center text-3xl font-bold italic tracking-tight bg-gradient-to-b from-bone via-bone to-bone-mute bg-clip-text text-transparent pr-8">
          NILLAD
        </h1>
      </header>

      <div className="flex-1 flex flex-col justify-center gap-5 py-2">
        <NilladGraph recent={recent} />
        <HomeSuggestions suggestions={suggestions} />
      </div>
    </main>
  );
}
