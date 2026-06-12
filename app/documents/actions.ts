"use server";

import { revalidatePath } from "next/cache";
import { isAuthed } from "@/lib/auth";
import { getDocument, deleteDocument } from "@/lib/documents";

// Full extracted text for one document — loaded on demand when the detail sheet
// opens, so the list query stays light (text can be ~200k chars each).
export async function getDocText(id: number): Promise<string> {
  if (!(await isAuthed())) return "";
  const d = getDocument(id);
  return (d?.text || "").trim();
}

export async function removeDoc(id: number): Promise<void> {
  if (!(await isAuthed())) return;
  deleteDocument(id);
  revalidatePath("/documents");
}
