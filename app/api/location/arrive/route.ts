import { NextRequest } from "next/server";
import { fireArrival } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hit by an iOS Shortcut "Arrive" automation: /api/location/arrive?key=…&place=Lehi
// Fires any matching active location reminders. Gated by ?key=NF_SESSION_SECRET
// (the Shortcut has no cookie). Accepts place via query or JSON body.
async function run(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-location-key") || "";
  if (!process.env.NF_SESSION_SECRET || key !== process.env.NF_SESSION_SECRET) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let place = url.searchParams.get("place") || "";
  if (!place) {
    try {
      const body = (await req.json()) as { place?: string };
      place = body?.place || "";
    } catch {
      /* no body — rely on query */
    }
  }
  try {
    const res = await fireArrival(place);
    return Response.json({ ok: true, ...res });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return run(req);
}
export async function POST(req: NextRequest): Promise<Response> {
  return run(req);
}
