"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polls the server component data on an interval via router.refresh(), so new
// inbound/outbound SMS appear without a manual reload. Lightweight: refresh()
// re-runs the page's server query and reconciles the React tree (no full
// navigation, no fl: scroll position is preserved). Pauses while the tab is
// hidden to avoid pointless work. $0/local — just re-reads nillad.db.
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
