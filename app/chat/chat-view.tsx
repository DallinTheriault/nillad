"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Mic, ArrowUp, Loader2, X, ImageIcon, Brain } from "lucide-react";
import { MenuButton } from "@/components/menu-button";
import { createChat, appendMessage } from "./actions";

type Msg = { role: "user" | "assistant"; content: string; image?: string; hasImage?: boolean };

export function ChatView({
  chatId: initialChatId = null,
  initialMessages = [],
  initialQ = "",
  tools,
}: {
  chatId?: number | null;
  initialMessages?: Msg[];
  initialQ?: string;
  // Optional per-surface tool scoping. Omitted → the API uses the full default
  // set (correct for general chat). A narrow surface can pass e.g.
  // ["send_sms","jobs_contacts","get_time"] to focus tool selection.
  tools?: string[];
}) {
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  // "Think harder" — sticky toggle. Off = snappy ~1-2s replies; on = Nillad runs
  // a full chain-of-thought first (slower, deeper) until turned back off.
  const [thinkHard, setThinkHard] = useState(false);
  const chatIdRef = useRef<number | null>(initialChatId);
  const sent = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  async function send(text: string, image?: string | null) {
    const q = text.trim();
    if ((!q && !image) || busy) return;
    setErr(null);
    setInput("");
    setPendingImage(null);

    // Ensure a persisted chat exists.
    if (chatIdRef.current == null) {
      const { id } = await createChat(q || "Image");
      chatIdRef.current = id;
      window.history.replaceState({}, "", `/chat/${id}`);
    }
    const cid = chatIdRef.current;

    const userMsg: Msg = { role: "user", content: q, image: image ?? undefined, hasImage: !!image };
    const history = [...msgs, userMsg];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setBusy(true);
    void appendMessage(cid, "user", q || "[image]", !!image, image ?? null);

    try {
      // Build the payload: prior turns as text; the new turn multimodal if image.
      const apiMessages = history.map((m, i) => {
        if (i === history.length - 1 && image) {
          return {
            role: m.role,
            content: [
              ...(q ? [{ type: "text", text: q }] : []),
              { type: "image_url", image_url: { url: image } },
            ],
          };
        }
        return { role: m.role, content: m.content };
      });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, think: thinkHard, ...(tools ? { tools } : {}) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]" || !data) continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              setMsgs((m) => {
                const c = [...m];
                c[c.length - 1] = { role: "assistant", content: acc };
                return c;
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (acc) void appendMessage(cid, "assistant", acc);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsgs((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialQ && !sent.current && initialMessages.length === 0) {
      sent.current = true;
      send(initialQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  }

  function toggleDictation() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      // iOS Safari: no in-app recognition — focus the field so the keyboard mic works.
      inputRef.current?.focus();
      return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setInput(txt);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
    setListening(true);
    r.start();
  }

  const hasText = input.trim().length > 0;
  const canSend = hasText || !!pendingImage;

  return (
    <main className="flex flex-col h-dvh overflow-hidden max-w-2xl mx-auto bg-bg">
      <header className="relative flex items-center px-3 pt-4 pb-3 border-b border-border shrink-0">
        <MenuButton />
        <h1 className="absolute left-1/2 -translate-x-1/2 text-xl font-bold italic tracking-tight bg-gradient-to-b from-bone to-bone-mute bg-clip-text text-transparent">
          Nillad
        </h1>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        {msgs.length === 0 && !busy && (
          <p className="text-center text-sm text-bone-mute py-10">Ask Nillad anything.</p>
        )}
        <div className="space-y-2.5">
          {msgs.map((m, i) => {
            const me = m.role === "user";
            const streaming = busy && i === msgs.length - 1 && m.role === "assistant";
            return (
              <div key={i} className={`flex ${me ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-[15px] leading-snug whitespace-pre-wrap break-words ${
                    me ? "bubble-stroke-gradient text-bone" : "bubble-stroke-muted text-bone"
                  }`}
                >
                  {m.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt="" className="rounded-lg mb-2 max-h-48 w-auto" />
                  )}
                  {!m.image && m.hasImage && (
                    <span className="flex items-center gap-1 text-bone-mute text-xs mb-1">
                      <ImageIcon size={12} /> image
                    </span>
                  )}
                  {m.content ||
                    (streaming ? <Loader2 size={15} className="animate-spin text-bone-mute" /> : "")}
                </div>
              </div>
            );
          })}
        </div>
        {err && <p className="text-xs text-warmred font-mono text-center mt-4 px-4">{err}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) send(input, pendingImage);
          else inputRef.current?.focus();
        }}
        className="shrink-0 px-3 pt-2 bg-bg"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.6rem)" }}
      >
        {pendingImage && (
          <div className="max-w-2xl mx-auto mb-2 flex">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingImage} alt="" className="h-16 w-16 object-cover rounded-lg border border-border" />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                aria-label="Remove image"
                className="absolute -top-2 -right-2 w-5 h-5 grid place-items-center rounded-full bg-surface-2 border border-border text-bone-dim"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 gradient-pill pl-1.5 pr-1.5 py-1.5">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach image"
            className="w-9 h-9 grid place-items-center rounded-full text-bone-dim hover:text-bone active:opacity-60 shrink-0"
          >
            <Plus size={20} />
          </button>
          <button
            type="button"
            onClick={() => setThinkHard((v) => !v)}
            aria-label="Think harder"
            aria-pressed={thinkHard}
            title={thinkHard ? "Thinking harder — tap to turn off" : "Think harder (slower, deeper)"}
            className={`w-9 h-9 grid place-items-center rounded-full shrink-0 transition ${
              thinkHard ? "gradient-fill text-bone" : "text-bone-dim hover:text-bone active:opacity-60"
            }`}
          >
            <Brain size={18} />
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? "Listening…" : thinkHard ? "Think harder is on…" : "How can I help?"}
            enterKeyHint="send"
            className="flex-1 bg-transparent outline-none text-bone placeholder:text-bone-mute italic px-1 min-w-0"
          />
          {canSend ? (
            <button
              type="submit"
              disabled={busy}
              aria-label="Send"
              className="w-9 h-9 grid place-items-center rounded-full shrink-0 gradient-fill text-bone disabled:opacity-50"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleDictation}
              aria-label="Dictate"
              className={`w-9 h-9 grid place-items-center rounded-full shrink-0 transition ${
                listening ? "gradient-fill text-bone animate-pulse" : "text-bone-dim hover:text-bone"
              }`}
            >
              <Mic size={18} />
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
