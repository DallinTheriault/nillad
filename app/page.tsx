import { MenuButton } from "@/components/menu-button";
import { BlackHole } from "@/components/black-hole";
import { HomeSuggestions } from "@/components/home-suggestions";
import { HomeAlerts } from "@/components/home-alerts";
import { HomeContinue } from "@/components/home-continue";
import { getHomeSuggestions, getRecentChats, getHomeAlerts } from "@/lib/home-context";

export const dynamic = "force-dynamic";

export default function Home() {
  const suggestions = getHomeSuggestions().slice(0, 2);
  const chats = getRecentChats(3);
  const alerts = getHomeAlerts();

  return (
    <main className="h-dvh max-w-2xl mx-auto flex flex-col overflow-hidden">
      <header className="px-4 pt-4 flex items-center shrink-0">
        <MenuButton />
        <h1 className="flex-1 text-center text-3xl font-bold italic tracking-tight bg-gradient-to-b from-bone via-bone to-bone-mute bg-clip-text text-transparent pr-8">
          NILLAD
        </h1>
      </header>

      {/* Heads-up: anything you need to see right now */}
      {alerts.length > 0 && (
        <div className="shrink-0">
          <HomeAlerts alerts={alerts} />
        </div>
      )}

      {/* The black-hole brain fills the rest; swipe to orbit. Chips + recent
          chats float over its lower half (no scroll — everything fits). */}
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-0">
          <BlackHole />
        </div>
        <div className="absolute inset-x-0 bottom-0 pb-28 flex flex-col items-center gap-3 pointer-events-none">
          {chats.length > 0 && (
            <div className="pointer-events-auto w-full">
              <HomeContinue chats={chats} />
            </div>
          )}
          <div className="pointer-events-auto w-full">
            <HomeSuggestions suggestions={suggestions} />
          </div>
        </div>
      </div>
    </main>
  );
}
