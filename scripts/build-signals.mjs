// Costruisce src-tauri/src/signals.json dall'output del workflow multilingua.
// Uso: node scripts/build-signals.mjs <percorso-output-workflow>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) throw new Error("Passare il percorso del file di output del workflow");

const raw = JSON.parse(readFileSync(src, "utf8"));
const result = raw.result ?? raw; // il file avvolge in { result: ... }
const genSignals = result.signals ?? [];

const WEIGHTS = {
  kids_club: 22, kids_facilities: 18, family_rooms: 14, childcare: 12,
  kids_dining: 10, activities_age: 10, safety: 8, reviews: 6,
};
const ORDER = ["kids_club", "kids_facilities", "family_rooms", "childcare", "kids_dining", "activities_age", "safety", "reviews"];

// Parole singole troppo generiche: vietate come termine da sole (causerebbero falsi positivi).
// I composti (es. "kids club", "club infantil", "miniclub") restano ammessi.
const DENY = new Set([
  "kids","kid","child","children","baby","babies","toddler","bimbo","bimbi","bimba","bambino","bambini","bambina","bambine",
  "niño","ninos","niños","nino","nina","niña","enfant","enfants","kind","kinder","kindje","family","familie","familia","famiglia",
  "famille","família","bébé","bebe","bebé","infantil","junior","teen","teens","teenager","ados","kinderen","barn","børn","lapsi",
  "lapset","dziecko","dzieci","copii","copil","otrok","otroci","dijete","djeca","deca","деца","дети","ребёнок","дитина","діти",
  "子供","子ども","お子様","儿童","小孩","어린이","아이","เด็ก","trẻ","anak","bata","παιδί","παιδιά","ילד","ילדים","طفل","أطفال","بچہ","بچے","کودک","کودکان",
  "pool","piscina","spa","wellness","club","clubs","menu","menù","buffet","family-friendly","familienfreundlich",
]);

const seen = {};
for (const k of ORDER) seen[k] = new Set();
for (const sig of genSignals) {
  const k = sig.key;
  if (!seen[k]) continue;
  for (const t of sig.terms ?? []) {
    const s = String(t).trim().toLowerCase();
    if (s.length < 3) continue;
    if (!s.includes(" ") && DENY.has(s)) continue; // singola parola generica -> scarta
    seen[k].add(s);
  }
}

const signals = ORDER.map((k) => ({
  key: k,
  weight: WEIGHTS[k],
  patterns: [...seen[k]].sort(),
}));

const out = resolve(ROOT, "src-tauri/src/signals.json");
writeFileSync(out, JSON.stringify({ signals }, null, 0) + "\n");

console.log("signals.json scritto:", out);
for (const s of signals) console.log(`  ${s.key}: ${s.patterns.length} termini`);
console.log("totale termini:", signals.reduce((a, s) => a + s.patterns.length, 0));
