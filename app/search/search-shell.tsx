"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  Loader2,
  X,
  StickyNote,
  BookText,
  FileText,
  Briefcase,
  Users,
  Mail,
  MessageSquare,
  ListChecks,
  Receipt,
  Calendar,
  Bell,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

type Hit = { title: string; snippet?: string; href?: string; meta?: string };
type Section = { key: string; label: string; icon: string; hits: Hit[] };

const ICONS: Record<string, LucideIcon> = {
  StickyNote,
  BookText,
  FileText,
  Briefcase,
  Users,
  Mail,
  MessageSquare,
  ListChecks,
  Receipt,
  Calendar,
  Bell,
};

// Wrap query-term matches in a subtle highlight so the eye lands on why a row matched.
function highlight(text: string, terms: string[]): React.ReactNode {
  if (!text || !terms.length) return text;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (!esc.length) return text;
  const re = new RegExp(`(${esc.join("|")})`, "ig");
  const parts = text.split(re);
  return parts.map((p, i) =>
    esc.some((e) => new RegExp(`^${e}$`, "i").test(p)) ? (
      <mark key={i} className="bg-periwinkle/25 text-bone rounded-[2px] px-0.5">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function SearchShell() {
  const [q, setQ] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0); // ignore out-of-order responses
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced live search — fires ~220ms after the last keystroke.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setSections([]);
      setSearched(false);
      setLoading(false);
      abort.current?.abort();
      return;
    }
    setLoading(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (id === seq.current) {
          setSections(Array.isArray(data.sections) ? data.sections : []);
          setSearched(true);
        }
      } catch {
        /* aborted or network — ignore */
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const terms = q.trim().toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const total = sections.reduce((n, s) => n + s.hits.length, 0);

  return (
    <div className="px-3">
      {/* Search box — sticky so results scroll under it */}
      <div className="sticky top-0 z-10 -mx-3 px-3 pb-3 pt-1 bg-bg/90 backdrop-blur">
        <div className="flex items-center gap-2 rounded-2xl border border-border-strong bg-surface px-3.5 py-3 focus-within:border-periwinkle/70 transition-colors">
          <Search size={18} className="shrink-0 text-bone-mute" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything — notes, jobs, texts, emails…"
            className="flex-1 bg-transparent text-[15px] text-bone placeholder:text-bone-mute outline-none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {loading ? (
            <Loader2 size={17} className="shrink-0 animate-spin text-periwinkle" />
          ) : q ? (
            <button onClick={() => setQ("")} className="shrink-0 text-bone-mute hover:text-bone">
              <X size={17} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Empty / states */}
      {q.trim().length < 2 ? (
        <p className="mt-10 text-center text-sm text-bone-mute">
          Search across notes, the Axiom vault, jobs, contacts, emails, texts, expenses and more —
          results group under each section.
        </p>
      ) : searched && total === 0 && !loading ? (
        <p className="mt-10 text-center text-sm text-bone-mute">
          No matches for “{q.trim()}”.
        </p>
      ) : (
        <div className="space-y-5 pt-1">
          {sections.map((sec) => {
            const Icon = ICONS[sec.icon] ?? StickyNote;
            return (
              <section key={sec.key}>
                {/* Parent section header */}
                <div className="flex items-center gap-2 px-1 pb-1.5">
                  <Icon size={15} className="text-periwinkle-soft" />
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide text-bone-dim">
                    {sec.label}
                  </h2>
                  <span className="text-[11px] text-bone-mute">{sec.hits.length}</span>
                </div>
                {/* Results, populated under their parent section */}
                <div className="overflow-hidden rounded-2xl border border-border bg-surface divide-y divide-border">
                  {sec.hits.map((h, i) => {
                    const inner = (
                      <div className="flex items-start gap-2 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[14px] font-medium text-bone">
                              {highlight(h.title, terms)}
                            </span>
                            {h.meta ? (
                              <span className="shrink-0 truncate text-[11px] text-bone-mute">
                                {h.meta}
                              </span>
                            ) : null}
                          </div>
                          {h.snippet ? (
                            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-bone-dim">
                              {highlight(h.snippet, terms)}
                            </p>
                          ) : null}
                        </div>
                        {h.href ? (
                          <ChevronRight size={16} className="mt-0.5 shrink-0 text-bone-mute" />
                        ) : null}
                      </div>
                    );
                    return h.href ? (
                      <Link key={i} href={h.href} className="block hover:bg-surface-2 transition-colors">
                        {inner}
                      </Link>
                    ) : (
                      <div key={i}>{inner}</div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
