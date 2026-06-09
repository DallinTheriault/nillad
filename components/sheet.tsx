"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Bottom sheet rendered via a portal to document.body. Critical: the page is
// wrapped in `.page-fade` (will-change: opacity), which is a stacking context —
// any drawer rendered inside it is trapped BELOW the global fixed ChatBar
// (z-20), so its action buttons hid behind the chat bar. Portaling to body
// escapes that context so the sheet (z-50) sits above everything, and the
// content gets bottom padding so the last buttons clear the home indicator.
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    // Lock background scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div
        className="absolute bottom-0 inset-x-0 bg-bg border-t border-border rounded-t-3xl max-h-[88vh] overflow-y-auto animate-[sheetUp_220ms_ease-out]"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] uppercase tracking-[0.22em] text-bone-mute font-mono">{title}</div>
            <button
              onClick={onClose}
              className="w-9 h-9 grid place-items-center rounded-full border border-border text-bone-dim hover:text-bone hover:border-border-strong transition"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Shared form field label wrapper (matches the existing drawer styling).
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
