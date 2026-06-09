// Thin wrapper around the n8n send-sms webhook. Keeps Twilio creds in n8n,
// so the dashboard never sees them. Configure the webhook URL via env if you
// want a different host.

const SEND_URL =
  process.env.N8N_SEND_SMS_WEBHOOK ||
  "http://localhost:5678/webhook/nillad-send-sms";

export type SendResult =
  | { ok: true; message_sid?: string; status?: string }
  | { ok: false; error: string };

export async function sendSmsViaN8n(to: string, body: string): Promise<SendResult> {
  try {
    const r = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, body }),
    });
    if (!r.ok) {
      const text = await r.text();
      return { ok: false, error: `n8n ${r.status}: ${text.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as {
      message_sid?: string;
      status?: string;
    };
    return { ok: true, message_sid: j.message_sid, status: j.status };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}
