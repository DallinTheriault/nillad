"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2 } from "lucide-react";

type Entry = { cmd: string; stdout?: string; stderr?: string; error?: string; cwd?: string };

export function TerminalShell() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, busy]);

  async function run(cmd: string) {
    const c = cmd.trim();
    if (!c || busy) return;
    setInput("");
    setHistory((h) => [...h, c]);
    setHistIdx(-1);
    setBusy(true);
    try {
      const res = await fetch("/api/terminal/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: c, cwd: cwd || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.cwd) setCwd(j.cwd);
      setEntries((e) => [...e, { cmd: c, stdout: j.stdout, stderr: j.stderr, error: j.error, cwd: j.cwd }]);
    } catch (e) {
      setEntries((en) => [...en, { cmd: c, error: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setInput(history[idx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx < 0) return;
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setInput("");
      } else {
        setHistIdx(idx);
        setInput(history[idx]);
      }
    }
  }

  const promptCwd = cwd || "PS";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-2 text-[11px] text-bone-mute font-mono border-b border-border shrink-0">
        Runs PowerShell on your PC via the host agent. Auth + token gated.
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed">
        {entries.length === 0 && !busy && (
          <p className="text-bone-mute">Type a command, e.g. <span className="text-periwinkle">Get-Date</span> or <span className="text-periwinkle">ls</span>.</p>
        )}
        {entries.map((e, i) => (
          <div key={i} className="mb-2.5">
            <div className="text-bone-dim break-all">
              <span className="text-green-400">{e.cwd || promptCwd}</span>
              <span className="text-bone-mute"> &gt; </span>
              <span className="text-bone">{e.cmd}</span>
            </div>
            {e.stdout ? <pre className="whitespace-pre-wrap text-bone break-all">{e.stdout}</pre> : null}
            {e.stderr ? <pre className="whitespace-pre-wrap text-amber-400 break-all">{e.stderr}</pre> : null}
            {e.error ? <pre className="whitespace-pre-wrap text-warmred break-all">{e.error}</pre> : null}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-bone-mute">
            <Loader2 size={13} className="animate-spin" /> running…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(input);
        }}
        className="shrink-0 px-3 pt-2 border-t border-border bg-bg"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.6rem)" }}
      >
        <div className="flex items-center gap-2 font-mono text-[12.5px]">
          <span className="text-green-400 shrink-0 max-w-[40%] truncate">{promptCwd}</span>
          <span className="text-bone-mute shrink-0">&gt;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            placeholder={busy ? "running…" : "command"}
            disabled={busy}
            className="flex-1 bg-transparent outline-none text-bone placeholder:text-bone-mute min-w-0"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Run" className="shrink-0 w-8 h-8 grid place-items-center rounded-lg gradient-fill text-bone disabled:opacity-40">
            <CornerDownLeft size={15} />
          </button>
        </div>
      </form>
    </div>
  );
}
