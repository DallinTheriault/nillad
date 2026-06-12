"use client";

import Link from "next/link";
import { Bell, Briefcase, DollarSign, Mail, Sparkles } from "lucide-react";
import type { HomeAlert } from "@/lib/home-context";

const ICONS = { reminder: Bell, job: Briefcase, invoice: DollarSign, email: Mail, approval: Sparkles };

// The "see it immediately" strip at the top of home: overdue/soon reminders,
// jobs today, money owed, important mail, drafts to approve. Empty → renders
// nothing (no clutter on a clear day).
export function HomeAlerts({ alerts }: { alerts: HomeAlert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="px-4 pt-1.5 space-y-1.5">
      {alerts.map((a, i) => {
        const Icon = ICONS[a.kind] || Bell;
        const dot = a.tone === "red" ? "bg-red-soft" : a.tone === "amber" ? "bg-amber-400" : "bg-periwinkle";
        const iconCol = a.tone === "red" ? "text-red-soft" : a.tone === "amber" ? "text-amber-300" : "text-periwinkle-soft";
        return (
          <Link
            key={i}
            href={a.href}
            className="nf-glass flex items-center gap-2.5 rounded-xl px-3 py-1.5 active:opacity-70 transition-opacity"
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot} ${a.tone !== "normal" ? "animate-pulse" : ""}`} />
            <Icon size={13} className={`shrink-0 ${iconCol}`} />
            <span className="text-[12px] text-bone truncate flex-1">{a.text}</span>
          </Link>
        );
      })}
    </div>
  );
}
