// Deep research: a multi-step web pipeline that goes beyond the single-shot
// web_search tool. Given a question, Nillad (1) plans a few diverse search
// angles, (2) searches each, (3) reads the strongest sources, and (4) hands a
// cited digest back to the chat model to synthesize a grounded answer.
//
// It runs entirely on the free stack (DuckDuckGo HTML + page fetch + local
// gemma for planning) — no API key, in keeping with the local-first goal. The
// onProgress callback feeds the chat's live status line ("Reading wsj.com"), so
// Dallin sees exactly what it's looking at as it works.

import { webSearch, fetchReadable, type SearchHit } from "@/lib/web";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";

const SUBQUERIES = 3; // search angles to plan
const MAX_SOURCES = 4; // pages actually read (context-budget aware)
const PAGE_CHARS = 2200; // chars kept per source

type Progress = (label: string) => void;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Ask the local model for a few focused, diverse search queries. Best-effort:
// any failure falls back to just the original question, so research still runs.
async function planQueries(query: string): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              `You plan web research. Given a question, output ${SUBQUERIES} diverse, focused web-search queries that together would answer it well (different angles, not rephrasings). Output ONLY the queries, one per line — no numbering, quotes, or commentary.`,
          },
          { role: "user", content: query },
        ],
        think: false,
        stream: false,
        options: { temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = (await res.json()) as { message?: { content?: string } };
    const lines = (j.message?.content || "")
      .split("\n")
      .map((l) => l.replace(/^\s*[-*\d.)\]]+\s*/, "").replace(/^["']|["']$/g, "").trim())
      .filter((l) => l.length > 2);
    const uniq = Array.from(new Set(lines)).slice(0, SUBQUERIES);
    return uniq.length ? uniq : [query];
  } catch {
    return [query];
  }
}

// Run the full pipeline and return a digest string for the chat model to
// synthesize from. The digest names its sources [1..N] so the model can cite.
export async function deepResearch(query: string, onProgress: Progress = () => {}): Promise<string> {
  if (!query.trim()) return "Error: deep_research needs a `query`.";

  onProgress("Planning the research…");
  const queries = await planQueries(query);

  // Search each angle, collecting unique URLs (first-seen order, which roughly
  // tracks relevance since each search is already ranked).
  const seen = new Set<string>();
  const candidates: SearchHit[] = [];
  for (const q of queries) {
    onProgress(`Searching for “${q.slice(0, 60)}”`);
    let hits: SearchHit[] = [];
    try {
      hits = await webSearch(q, 4);
    } catch {
      /* a blocked/empty single search shouldn't sink the whole run */
    }
    for (const h of hits) {
      const key = h.url.replace(/[#?].*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(h);
    }
  }

  if (!candidates.length) {
    return `No web results found while researching "${query}". The free search endpoint may be rate-limited — tell Dallin it came up empty and offer to retry.`;
  }

  // Read the strongest few sources in full.
  const picks = candidates.slice(0, MAX_SOURCES);
  const sources: { n: number; title: string; url: string; text: string }[] = [];
  let n = 0;
  for (const c of picks) {
    n++;
    onProgress(`Reading ${host(c.url)}`);
    let text = "";
    try {
      text = await fetchReadable(c.url, PAGE_CHARS);
    } catch {
      /* skip an unreadable page, keep its snippet below */
    }
    sources.push({ n, title: c.title, url: c.url, text: text || c.snippet || "(no readable text)" });
  }

  onProgress("Synthesizing…");

  const digest = sources
    .map((s) => `[${s.n}] ${s.title} — ${s.url}\n${s.text}`)
    .join("\n\n");

  return [
    `Deep-research findings for: "${query}"`,
    `Planned angles: ${queries.join(" | ")}`,
    "",
    `Read ${sources.length} source(s):`,
    digest,
    "",
    `Now write Dallin a grounded answer to "${query}" using ONLY these sources. Synthesize across them, note any disagreement, and cite with the source URLs. If the sources don't actually answer it, say so plainly.`,
  ].join("\n");
}
