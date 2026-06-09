// Host-side harness for the chat agent. Drives runAgentStream end-to-end against
// the live Ollama + nillad.db and prints what the client would receive.
// Run: npx tsx scripts/test-agent.ts "your prompt here"
import { runAgentStream, type ChatMsg } from "@/lib/agent";

const prompt = process.argv[2] || "What time is it?";
const think = process.argv[3] === "think";

async function main() {
  const messages: ChatMsg[] = [{ role: "user", content: prompt }];
  const t0 = Date.now();
  const stream = runAgentStream(messages, undefined, think);
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let firstTokenAt = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (data === "[DONE]" || !data) continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          text += delta;
        }
      } catch {
        /* ignore */
      }
    }
  }
  const total = Date.now() - t0;
  console.log(`\nPROMPT: ${prompt}`);
  console.log(`REPLY:  ${text}`);
  console.log(
    `TIMING: first token ${firstTokenAt ? firstTokenAt - t0 : "—"}ms | total ${total}ms`,
  );
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
