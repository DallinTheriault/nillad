"use client";

import { useEffect, useRef } from "react";

// Keeps a message thread pinned to the newest message. Scrolls to the bottom on
// first mount, and on updates only when the user is already near the bottom — so
// a live refresh never yanks them away while they're reading history. `dep`
// should be the message count so it re-runs when new messages arrive.
export function ScrollToBottom({ dep, targetId = "thread-scroll" }: { dep: number; targetId?: string }) {
  const first = useRef(true);
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (first.current || nearBottom) {
      el.scrollTop = el.scrollHeight;
      first.current = false;
    }
  }, [dep, targetId]);
  return null;
}
