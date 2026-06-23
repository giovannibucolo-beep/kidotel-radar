// Valuta un lotto Kidotel (kidotel-ai-batch.json) producendo results.json.
// Usa il `claude` di Claude Code (autenticato con la TUA sottoscrizione: nessuna chiave API).
// L'AI apre ogni sito (WebFetch), legge in qualsiasi lingua e assegna il voto con citazioni.
//
// Uso:
//   node scripts/score-batch.mjs <kidotel-ai-batch.json> [results.json]
// Opzioni via env:
//   CLAUDE_MODEL=sonnet|opus   (default sonnet)   CHUNK=6   SLEEP_MS=500
//
// Riprendibile: se results.json esiste, salta gli hotel già valutati. Salva dopo ogni gruppo.
// Flag verificati con `claude --help` (v2.1+): -p, --output-format json, --allowedTools, --permission-mode dontAsk, --model.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const batchPath = process.argv[2];
if (!batchPath) {
  console.error("Uso: node scripts/score-batch.mjs <kidotel-ai-batch.json> [results.json]");
  process.exit(1);
}
const outPath = resolve(process.argv[3] || "results.json");
const MODEL = process.env.CLAUDE_MODEL || "sonnet";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CHUNK = Math.max(1, parseInt(process.env.CHUNK || "6", 10));
const SLEEP_MS = parseInt(process.env.SLEEP_MS || "500", 10);

const KEYS = ["kids_club", "kids_facilities", "family_rooms", "childcare", "kids_dining", "activities_age", "safety"];

const batch = JSON.parse(readFileSync(resolve(batchPath), "utf8"));
const hotels = batch.hotels || [];
if (hotels.length === 0) {
  console.error("Nessun hotel nel lotto.");
  process.exit(1);
}

// risultati già presenti (riprendibilità)
const byId = new Map();
if (existsSync(outPath)) {
  try {
    for (const r of (JSON.parse(readFileSync(outPath, "utf8")).results || [])) byId.set(r.id, r);
  } catch { /* file parziale: si riparte */ }
}

const todo = hotels.filter((h) => !byId.has(h.id));
console.log(`Lotto: ${hotels.length} hotel · già valutati: ${byId.size} · da fare: ${todo.length} · modello: ${MODEL}`);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  try { return JSON.parse(candidate); } catch { /* continua */ }
  const s = candidate.indexOf("["), e = candidate.lastIndexOf("]");
  if (s >= 0 && e > s) {
    try { return JSON.parse(candidate.slice(s, e + 1)); } catch { /* niente */ }
  }
  return null;
}

function scoreChunk(chunk) {
  const prompt =
    `Sei un valutatore family-fit di hotel. Per OGNI hotel qui sotto apri il sito (campo "website") con WebFetch, ` +
    `leggi le pagine rilevanti in QUALSIASI lingua e valuta quanto è adatto alle famiglie con bambini.\n` +
    `Assegna "family_fit_score" 0-100. Per ogni servizio family trovato aggiungi a "breakdown" un elemento con ` +
    `"key" (uno di: ${KEYS.join(", ")}), "present": true, "quote" (frase BREVE citata testualmente dal sito) e "url".\n` +
    `REGOLA: non inventare. Se non c'è prova esplicita sul sito, NON assegnare il punto. Se il sito non è raggiungibile, family_fit_score 0 e breakdown vuoto.\n` +
    `Rispondi SOLO con un array JSON, un elemento per hotel, con lo stesso "id". Nessun altro testo.\n\n` +
    `HOTEL:\n${JSON.stringify(chunk, null, 0)}`;

  const res = spawnSync(
    CLAUDE_BIN,
    ["-p", prompt, "--model", MODEL, "--allowedTools", "WebFetch", "--permission-mode", "dontAsk", "--output-format", "json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  let outer;
  try { outer = JSON.parse(res.stdout); } catch {
    console.error("  output non-JSON dal CLI:", (res.stderr || res.stdout || "").slice(0, 300));
    return [];
  }
  if (outer.is_error) {
    console.error("  errore da claude:", outer.result || "(sconosciuto)");
    if (String(outer.result || "").includes("401")) console.error("  -> esegui prima:  claude login");
    return [];
  }
  const arr = extractJson(outer.result);
  if (!Array.isArray(arr)) { console.error("  nessun array JSON nella risposta"); return []; }
  return arr;
}

let done = byId.size;
for (let i = 0; i < todo.length; i += CHUNK) {
  const chunk = todo.slice(i, i + CHUNK).map((h) => ({ id: h.id, name: h.name, website: h.website }));
  const arr = scoreChunk(chunk);
  for (const r of arr) {
    if (!r || !r.id) continue;
    byId.set(r.id, {
      id: r.id,
      family_fit_score: Math.max(0, Math.min(100, Number(r.family_fit_score) || 0)),
      breakdown: Array.isArray(r.breakdown) ? r.breakdown.filter((b) => b && KEYS.includes(b.key) && b.present) : [],
    });
  }
  done = byId.size;
  writeFileSync(outPath, JSON.stringify({ results: [...byId.values()] }, null, 2) + "\n");
  console.log(`  valutati ${done}/${hotels.length} (salvato ${outPath})`);
  if (i + CHUNK < todo.length && SLEEP_MS > 0) sleep(SLEEP_MS);
}

console.log(`\nFatto. ${done}/${hotels.length} hotel in ${outPath}. Importalo in Kidotel Radar → "Importa valutazioni AI".`);
