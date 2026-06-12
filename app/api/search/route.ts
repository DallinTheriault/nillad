import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { searchAll } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Universal search. Returns sections grouped by source; the client renders results
// under their parent section as the user types. Session-gated (same as the app).
export async function GET(req: NextRequest): Promise<Response> {
  if (!(await isAuthed())) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return Response.json({ q, sections: [] });
  try {
    return Response.json({ q, sections: searchAll(q) });
  } catch (e) {
    return Response.json(
      { q, sections: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
