// Minimal vCard (.vcf) parser — enough to import iOS / iCloud / Google contact
// exports. Handles multiple cards per file, RFC-6350 line folding, property
// parameters (TEL;TYPE=CELL), and basic value unescaping. Picks one best phone per
// card (mobile/cell preferred) since our contacts table holds a single number.

export type ParsedContact = { name: string; phone: string; email: string };

function unfold(text: string): string[] {
  // A line beginning with a space or tab continues the previous logical line.
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescape(v: string): string {
  return v
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

// Split a property line into { name, params, value }.
function parseLine(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semi = left.indexOf(";");
  const name = (semi < 0 ? left : left.slice(0, semi)).toUpperCase().trim();
  const params = semi < 0 ? "" : left.slice(semi + 1).toUpperCase();
  return { name, params, value };
}

export function parseVCards(text: string): ParsedContact[] {
  const lines = unfold(text);
  const contacts: ParsedContact[] = [];

  let inCard = false;
  let fn = "";
  let nFallback = "";
  let email = "";
  let phones: { value: string; rank: number }[] = [];

  const flush = () => {
    if (!inCard) return;
    const name = fn || nFallback;
    phones.sort((a, b) => b.rank - a.rank);
    const phone = phones[0]?.value || "";
    if (name || phone || email) contacts.push({ name, phone, email });
    fn = "";
    nFallback = "";
    email = "";
    phones = [];
  };

  for (const line of lines) {
    const u = line.toUpperCase();
    if (u.startsWith("BEGIN:VCARD")) {
      inCard = true;
      fn = nFallback = email = "";
      phones = [];
      continue;
    }
    if (u.startsWith("END:VCARD")) {
      flush();
      inCard = false;
      continue;
    }
    if (!inCard) continue;
    const p = parseLine(line);
    if (!p) continue;

    if (p.name === "FN") {
      fn = unescape(p.value);
    } else if (p.name === "N" && !nFallback) {
      // N = Family;Given;Additional;Prefix;Suffix → "Given Family"
      const parts = p.value.split(";").map((s) => unescape(s));
      nFallback = [parts[1], parts[0]].filter(Boolean).join(" ").trim();
    } else if (p.name === "TEL") {
      const val = unescape(p.value).replace(/[^\d+()\-.\s]/g, "").trim();
      if (val) {
        // Prefer a mobile/cell/iPhone number when several are present.
        const rank = /CELL|MOBILE|IPHONE/.test(p.params) ? 3 : /VOICE|MAIN|HOME/.test(p.params) ? 1 : 2;
        phones.push({ value: val, rank });
      }
    } else if (p.name === "EMAIL" && !email) {
      email = unescape(p.value).trim();
    }
  }
  flush(); // in case END:VCARD was missing on the last card
  return contacts;
}
