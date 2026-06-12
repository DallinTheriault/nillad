// Tiny ntfy push helper (shared). Best-effort: a failed push never throws, so it
// can't break the caller (ingestion, briefing, etc.). Topics let Dallin subscribe
// selectively on his phone.

const NTFY = process.env.NILLAD_NTFY_URL || "http://host.docker.internal:8090";

export async function pushNtfy(
  topic: string,
  title: string,
  body: string,
  opts: { priority?: number; tags?: string; click?: string } = {},
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      Title: title,
      Priority: String(opts.priority ?? 3),
      "Content-Type": "text/plain; charset=utf-8",
    };
    if (opts.tags) headers.Tags = opts.tags;
    if (opts.click) headers.Click = opts.click;
    await fetch(`${NTFY}/${topic}`, {
      method: "POST",
      headers,
      body: body.slice(0, 3500),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* push is best-effort */
  }
}
