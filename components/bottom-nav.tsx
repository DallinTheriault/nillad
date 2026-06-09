"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Users, ListChecks, Calendar, Bell } from "lucide-react";

const tabs = [
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/activities", label: "Activity", icon: ListChecks },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/reminders", label: "Reminders", icon: Bell },
];

export function BottomNav() {
  const path = usePathname();
  if (!path) return null;
  // Hide on login and inside a specific message thread (typing surface owns the bottom)
  if (path.startsWith("/login")) return null;
  if (/^\/messages\/\d+/.test(path)) return null;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-bg/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <ul className="max-w-2xl mx-auto grid grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = path === href || path.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 active:bg-surface transition-colors ${
                  active ? "text-bone" : "text-bone-mute"
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2 : 1.5} />
                <span
                  className={`text-[10px] font-mono uppercase tracking-[0.14em] ${
                    active ? "text-bone" : "text-bone-mute"
                  }`}
                >
                  {label}
                </span>
                {active && (
                  <span
                    aria-hidden
                    className="absolute top-0 h-[2px] w-10 rounded-full"
                    style={{
                      background:
                        "linear-gradient(65deg, #625CC8 0%, #D52F31 100%)",
                    }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
