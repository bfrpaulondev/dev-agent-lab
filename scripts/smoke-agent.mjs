import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentPair } from '../src/agents.mjs';
import { starterWorkspace } from '../src/fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
await loadEnv();

const task = process.argv.slice(2).join(' ').trim() || 'Redesenhe este dashboard para parecer um produto moderno, calmo e profissional. Use uma base off-white, teal profundo como cor primária, estados semânticos discretos, cards com menos bordas e uma hierarquia de ações clara. Garanta responsividade até 320px, foco visível e sem novas dependências. Não invente funcionalidade de backend.';

if (!process.env.GROQ_API_KEY) {
  console.error('Missing GROQ_API_KEY. Copy .env.example to .env.local and configure a key.');
  process.exit(2);
}

console.log(`Task: ${task}\n`);
const result = await runAgentPair({
  apiKey: process.env.GROQ_API_KEY,
  task,
  seed: starterWorkspace,
  emit(event) {
    if (event.type === 'tool_finish') console.log(`[${event.agent}] ${event.tool}: ${event.path || event.query || event.outcome || ''}`);
    if (event.type === 'agent_finish') console.log(`[${event.agent}] finished${event.score != null ? ` score=${event.score}` : ''}${event.verdict ? ` verdict=${event.verdict}` : ''}`);
    if (event.type === 'cycle') console.log(`[orchestrator] ${event.message}`);
  },
});

const last = result.history.at(-1);
console.log('\n=== RESULT ===');
console.log(`status: ${result.status}`);
console.log(`review score: ${last?.review?.score ?? 'n/a'}`);
console.log(`review cycles: ${result.history.length}`);
console.log(`changed files: ${new Set(result.operations.map(item => item.path)).size}`);
console.log(`quality findings: ${result.quality.findings.length}`);
console.log('\nReviewer summary:');
console.log(last?.review?.summary || 'n/a');
if (last?.review?.findings?.length) {
  console.log('\nFindings:');
  for (const item of last.review.findings) console.log(`- [${item.severity}] ${item.title}: ${item.detail}`);
}
console.log('\nDiff:\n');
console.log(result.diff.slice(0, 30000));

async function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    try {
      const raw = await fs.readFile(path.join(root, name), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const i = trimmed.indexOf('=');
        if (i <= 0) continue;
        const key = trimmed.slice(0, i).trim();
        let value = trimmed.slice(i + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
