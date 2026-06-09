"use client";

import { Menu } from "lucide-react";
import { useDrawer } from "./drawer-provider";

// Hamburger that opens the global nav drawer. Drop into any page header.
export function MenuButton({ className = "" }: { className?: string }) {
  const { open } = useDrawer();
  return (
    <button
      onClick={open}
      aria-label="Open menu"
      className={`w-10 h-10 -ml-2 grid place-items-center text-bone active:opacity-60 transition ${className}`}
    >
      <Menu size={24} strokeWidth={2.5} />
    </button>
  );
}
