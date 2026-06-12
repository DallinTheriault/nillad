"use server";

import { revalidatePath } from "next/cache";
import { isAuthed } from "@/lib/auth";
import { approveAction, dismissAction } from "@/lib/automations";

export async function approve(id: number, body: string): Promise<{ ok: boolean; message: string }> {
  if (!(await isAuthed())) return { ok: false, message: "Not signed in." };
  const res = await approveAction(id, body);
  revalidatePath("/approvals");
  return res;
}

export async function dismiss(id: number): Promise<void> {
  if (!(await isAuthed())) return;
  dismissAction(id);
  revalidatePath("/approvals");
}
