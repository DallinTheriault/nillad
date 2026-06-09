// Format an E.164 phone for display. v1 handles US-style; +15551234567 -> (555) 123-4567.
export function fmtPhoneDisplay(p: string | null | undefined): string {
  if (!p) return "";
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const a = digits.slice(1, 4);
    const b = digits.slice(4, 7);
    const c = digits.slice(7, 11);
    return `(${a}) ${b}-${c}`;
  }
  if (digits.length === 10) {
    const a = digits.slice(0, 3);
    const b = digits.slice(3, 6);
    const c = digits.slice(6, 10);
    return `(${a}) ${b}-${c}`;
  }
  return p;
}

// Normalize loose user input to E.164 (US-first), so a typed contact number
// matches the +1XXXXXXXXXX form n8n stores on sms_threads.contact_phone.
// Returns null when it can't confidently normalize.
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus) return digits.length >= 8 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
