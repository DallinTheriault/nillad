import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { ingestDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // OCR / large PDFs can take a bit

// Receive an uploaded document (multipart form-data, field "file"), extract its
// text, summarize it, and store it so Nillad can read it. A route handler (not a
// server action) so binary PDFs/Word docs aren't blocked by the 1MB action cap.
export async function POST(req: NextRequest): Promise<Response> {
  if (!(await isAuthed())) return Response.json({ error: "Unauthorized." }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form-data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return Response.json({ error: "No file provided." }, { status: 400 });
  }
  const jobId = form.get("job_id");
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.length) return Response.json({ error: "Empty file." }, { status: 400 });
    const res = await ingestDocument(buf, file.name || "document", file.type || "", {
      source: "upload",
      jobId: jobId ? Number(jobId) || undefined : undefined,
    });
    return Response.json({ ok: true, ...res });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Ingest failed." }, { status: 500 });
  }
}
