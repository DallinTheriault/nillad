"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageCircle,
  MessageSquare,
  Users,
  ListChecks,
  Calendar,
  Bell,
  X,
} from "lucide-react";
import { useDrawer } from "./drawer-provider";

const links = [
  { href: "/", label: "Home", icon: Home },
  { href: "/chats", label: "Chats", icon: MessageCircle },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/activities", label: "Activity", icon: ListChecks },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/reminders", label: "Reminders", icon: Bell },
];

export function NavDrawer() {
  const { isOpen, close } = useDrawer();
  const path = usePathname();

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
        className={`absolute left-0 top-0 h-full w-72 max-w-[82%] bg-surface/80 border-r border-border backdrop-blur-2xl transition-transform duration-300 ease-out ${
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

        <ul className="px-3 space-y-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path?.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={close}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
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
      </nav>
    </div>
  );
}
