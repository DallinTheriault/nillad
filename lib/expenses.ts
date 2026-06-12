// Receipt → expense extraction. Sends a receipt photo to the local multimodal
// model (gemma supports images via Ollama's `images` array) and parses a compact
// JSON of vendor/amount/date/category. Everything stays local — the photo never
// leaves the box. The dashboard then shows it for a quick confirm before saving.

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";

export const EXPENSE_CATEGORIES = [
  "materials",
  "tools",
  "fuel",
  "equipment",
  "supplies",
  "meals",
  "other",
] as const;

export type ScannedReceipt = {
  vendor: string;
  amount: number | null;
  spent_on: string; // YYYY-MM-DD or ""
  category: string;
  summary: string;
};

// Strip a data-URL prefix to the bare base64 Ollama wants.
function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 && dataUrl.startsWith("data:") ? dataUrl.slice(comma + 1) : dataUrl;
}

export async function scanReceipt(dataUrl: string): Promise<ScannedReceipt> {
  const fallback: ScannedReceipt = { vendor: "", amount: null, spent_on: "", category: "other", summary: "" };
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      format: "json",
      think: false,
      stream: false,
      options: { temperature: 0.1 },
      messages: [
        {
          role: "system",
          content:
            'You read a photo of a receipt and extract its data. Respond ONLY as compact JSON: {"vendor": string, "amount": number, "spent_on": "YYYY-MM-DD", "category": one of ["materials","tools","fuel","equipment","supplies","meals","other"], "summary": "what was bought, short"}. amount = the FINAL total paid (a number, no currency symbol). If a field is unreadable use "" (or null for amount). Pick the best-fitting category for a contractor/painter.',
        },
        {
          role: "user",
          content: "Extract this receipt.",
          images: [toBase64(dataUrl)],
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`vision ${res.status}`);
  const j = (await res.json()) as { message?: { content?: string } };
  const m = (j.message?.content || "").match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    const p = JSON.parse(m[0]) as Record<string, unknown>;
    let amount: number | null = null;
    if (typeof p.amount === "number") amount = p.amount;
    else if (typeof p.amount === "string") {
      const n = Number(p.amount.replace(/[^0-9.]/g, ""));
      amount = Number.isFinite(n) && n > 0 ? n : null;
    }
    const category =
      typeof p.category === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(p.category)
        ? (p.category as string)
        : "other";
    return {
      vendor: typeof p.vendor === "string" ? p.vendor.slice(0, 120) : "",
      amount,
      spent_on: typeof p.spent_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.spent_on) ? p.spent_on : "",
      category,
      summary: typeof p.summary === "string" ? p.summary.slice(0, 200) : "",
    };
  } catch {
    return fallback;
  }
}
