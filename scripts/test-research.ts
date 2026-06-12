// Quick manual test of the deep-research pipeline against host Ollama.
//   OLLAMA_BASE_URL=http://localhost:11434 npx tsx scripts/test-research.ts "your question"
import { deepResearch } from "@/lib/research";

const q = process.argv[2] || "best budget mechanical keyboard for programming 2026";
(async () => {
  const out = await deepResearch(q, (label) => console.log(`  [status] ${label}`));
  console.log("\n========== DIGEST ==========\n");
  console.log(out.slice(0, 2500));
})();
