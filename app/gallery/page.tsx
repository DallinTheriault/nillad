import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { listPhotoFiles } from "@/lib/photos";
import { GalleryShell, type Photo } from "./gallery-shell";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const files = listPhotoFiles();
  const db = getDb();
  const meta = new Map(
    (db.prepare(`SELECT filename, caption, tags FROM photos`).all() as {
      filename: string;
      caption: string | null;
      tags: string | null;
    }[]).map((m) => [m.filename, m]),
  );

  const photos: Photo[] = files.map((f) => ({
    name: f.name,
    caption: meta.get(f.name)?.caption || "",
    tags: meta.get(f.name)?.tags || "",
  }));

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Gallery" />
      <GalleryShell photos={photos} />
    </main>
  );
}
