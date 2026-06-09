"use server";

import { redirect } from "next/navigation";
import { isPinValid, setSessionCookie, hasPinSet } from "@/lib/auth";

export async function login(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const pin = String(formData.get("pin") || "");
  if (!pin) return { ok: false, error: "Enter PIN." };
  if (!hasPinSet())
    return {
      ok: false,
      error: "No PIN set. Run `npm run set-pin <pin>` on the host first.",
    };
  if (!isPinValid(pin)) return { ok: false, error: "Wrong PIN." };
  await setSessionCookie();
  return { ok: true };
}

export async function logoutAction() {
  const { clearSessionCookie } = await import("@/lib/auth");
  await clearSessionCookie();
  redirect("/login");
}
