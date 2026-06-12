"use client";

import { Printer, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function InvoiceToolbar() {
  const router = useRouter();
  return (
    <div className="no-print sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-bg/90 backdrop-blur border-b border-border">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-bone-dim hover:text-bone text-sm">
        <ArrowLeft size={16} /> Back
      </button>
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 gradient-pill px-4 py-2 text-sm font-medium"
      >
        <Printer size={15} /> Print / Save PDF
      </button>
    </div>
  );
}
