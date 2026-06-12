"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Search,
  Sparkles,
  LayoutDashboard,
  MessageCircle,
  MessageSquare,
  Mail,
  FileText,
  Image,
  Receipt,
  Repeat,
  Wallet,
  Briefcase,
  Users,
  ListChecks,
  Calendar,
  Bell,
  Plug,
  TerminalSquare,
  ChevronDown,
  X,
  LogOut,
} from "lucide-react";
import { useDrawer } from "./drawer-provider";
import { logoutAction } from "@/app/login/actions";

const groups: { heading: string | null; links: { href: string; label: string; icon: typeof Home }[] }[] = [
  {
    heading: null, // top — most-used, no header
    links: [
      { href: "/", label: "Home", icon: Home },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/finances", label: "Finances", icon: Wallet },
      { href: "/search", label: "Search", icon: Search },
      { href: "/chats", label: "Chats", icon: MessageCircle },
    ],
  },
  {
    heading: "Work",
    links: [
      { href: "/jobs", label: "Jobs", icon: Briefcase },
      { href: "/approvals", label: "Approvals", icon: Sparkles },
      { href: "/expenses", label: "Expenses", icon: Receipt },
      { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/contacts", label: "Contacts", icon: Users },
    ],
  },
  {
    heading: "Comms",
    links: [
      { href: "/messages", label: "Messages", icon: MessageSquare },
      { href: "/inbox", label: "Inbox", icon: Mail },
      { href: "/connections", label: "Connections", icon: Plug },
    ],
  },
  {
    heading: "Life",
    links: [
      { href: "/activities", label: "Activity", icon: ListChecks },
      { href: "/calendar", label: "Calendar", icon: Calendar },
      { href: "/reminders", label: "Reminders", icon: Bell },
      { href: "/gallery", label: "Gallery", icon: Image },
    ],
  },
  {
    heading: "System",
    links: [{ href: "/terminal", label: "Terminal", icon: TerminalSquare }],
  },
];

const COLLAPSE_KEY = "nf-nav-collapsed";

// A named group is collapsed by default unless it contains the active route — so
// the drawer opens minimal (top links + just your current section), and any
// manual expand/collapse is remembered.
function defaultCollapsed(path: string | null): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of groups) {
    if (!g.heading) continue;
    const hasActive = g.links.some((l) => (l.href === "/" ? path === "/" : path?.startsWith(l.href)));
    out[g.heading] = !hasActive;
  }
  return out;
}

export function NavDrawer() {
  const { isOpen, close } = useDrawer();
  const path = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => defaultCollapsed(path));

  // After mount, apply any saved per-section state over the path-based default.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed((cur) => ({ ...cur, ...(JSON.parse(raw) as Record<string, boolean>) }));
    } catch {
      /* no saved state */
    }
  }, []);

  function toggle(heading: string) {
    setCollapsed((cur) => {
      const next = { ...cur, [heading]: !cur[heading] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* best-effort persistence */
      }
      return next;
    });
  }

  return (
    <div
      className={`fixed inset-0 z-40 ${isOpen ? "" : "pointer-events-none"}`}
      aria-hidden={!isOpen}
    >
      {/* Heavy blur over the whole app behind the drawer */}
      <button
        onClick={close}
        aria-label="Close menu"
        className={`absolute inset-0 bg-black/40 backdrop-blur-xl transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      />

      <nav
        className={`absolute left-0 top-0 h-full w-72 max-w-[82%] flex flex-col bg-surface/80 border-r border-border backdrop-blur-2xl transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 1rem)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="flex items-center justify-between px-5 mb-6">
          <span className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/nillad-mark.png" alt="" className="w-7 h-7" />
            <span className="text-xl font-bold italic tracking-tight bg-gradient-to-b from-bone to-bone-mute bg-clip-text text-transparent">
              NILLAD
            </span>
          </span>
          <button
            onClick={close}
            aria-label="Close"
            className="w-9 h-9 grid place-items-center rounded-full border border-border text-bone-dim hover:text-bone transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-3 flex-1 overflow-y-auto">
          {groups.map((group, gi) => {
            const isCollapsed = group.heading ? !!collapsed[group.heading] : false;
            return (
              <div key={group.heading ?? "top"} className={gi > 0 ? "mt-6" : ""}>
                {group.heading ? (
                  <button
                    onClick={() => toggle(group.heading!)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 mb-1.5 text-[13px] uppercase tracking-[0.2em] text-bone-dim font-mono hover:text-bone transition-colors"
                    aria-expanded={!isCollapsed}
                  >
                    <ChevronDown
                      size={15}
                      className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                    {group.heading}
                  </button>
                ) : null}
                {!isCollapsed && (
                  <ul className="space-y-1">
                    {group.links.map(({ href, label, icon: Icon }) => {
                      const active = href === "/" ? path === "/" : path?.startsWith(href);
                      return (
                        <li key={href}>
                          <Link
                            href={href}
                            onClick={close}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                              active
                                ? "bubble-stroke-gradient text-bone"
                                : "text-bone-dim hover:text-bone hover:bg-surface-2"
                            }`}
                          >
                            <Icon size={18} />
                            <span className="text-[15px] font-medium">{label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <form action={logoutAction} className="px-3 pt-3 mt-2 border-t border-border">
          <button
            type="submit"
            onClick={close}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-bone-dim hover:text-bone hover:bg-surface-2 transition-colors"
          >
            <LogOut size={18} />
            <span className="text-[15px] font-medium">Sign out</span>
          </button>
        </form>
      </nav>
    </div>
  );
}
