// Validate the 12 Psych/Soc taxonomy JSON files produced by the build agents.
// Plain node (no deps). Run: node scripts/validate-psychsoc.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "mcat-psychsoc-taxonomy");
const CODES = ["6A","6B","6C","7A","7B","7C","8A","8B","8C","9A","9B","10A"];

let totalUmb = 0, totalIntro = 0, totalDepth = 0;
const errors = [];
const perCat = [];

for (const code of CODES) {
  const path = join(DIR, `${code}.json`);
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    errors.push(`${code}: CANNOT PARSE — ${e.message}`);
    continue;
  }
  if (data.category_code !== code) errors.push(`${code}: category_code mismatch = ${data.category_code}`);
  if (!Array.isArray(data.umbrellas)) { errors.push(`${code}: umbrellas not array`); continue; }

  const slugs = new Map();   // slug -> where
  const labels = new Map();  // lower label -> where
  let umb = 0, intro = 0, depth = 0;

  const seeSlug = (s, where) => {
    if (!s || typeof s !== "string") { errors.push(`${code}: bad slug at ${where}: ${JSON.stringify(s)}`); return; }
    if (!/^[a-z0-9_]+$/.test(s)) errors.push(`${code}: slug not snake_case "${s}" (${where})`);
    if (slugs.has(s)) errors.push(`${code}: DUP SLUG "${s}" (${where} & ${slugs.get(s)})`);
    else slugs.set(s, where);
  };
  const seeLabel = (l, where) => {
    if (!l || typeof l !== "string") { errors.push(`${code}: bad label at ${where}`); return; }
    const key = l.trim().toLowerCase();
    if (labels.has(key)) errors.push(`${code}: DUP LABEL "${l}" (${where} & ${labels.get(key)})`);
    else labels.set(key, where);
  };
  const checkEx = (ex, where) => {
    if (!Array.isArray(ex) || ex.length < 1) errors.push(`${code}: examples missing/empty (${where})`);
    else if (!ex.every((x) => typeof x === "string" && x.trim())) errors.push(`${code}: non-string example (${where})`);
  };

  for (const u of data.umbrellas) {
    umb++;
    if (!u.slug || !u.label || !u.description) errors.push(`${code}: umbrella missing fields (${u.slug || u.label})`);
    seeSlug(u.slug, `umb:${u.slug}`);
    seeLabel(u.label, `umb:${u.slug}`);
    if (!u.intro) errors.push(`${code}: umbrella "${u.slug}" missing intro`);
    else {
      intro++;
      seeSlug(u.intro.slug, `intro:${u.intro.slug}`);
      seeLabel(u.intro.label, `intro:${u.intro.slug}`);
      if (!u.intro.description) errors.push(`${code}: intro "${u.intro.slug}" missing description`);
      checkEx(u.intro.examples, `intro:${u.intro.slug}`);
      if (u.intro.slug && u.slug && u.intro.slug !== `${u.slug}_intro`)
        errors.push(`${code}: intro slug "${u.intro.slug}" != "${u.slug}_intro" (non-fatal)`);
    }
    if (!Array.isArray(u.in_depth) || u.in_depth.length < 1) errors.push(`${code}: umbrella "${u.slug}" has no in_depth`);
    else for (const d of u.in_depth) {
      depth++;
      if (!d.slug || !d.label || !d.description) errors.push(`${code}: in_depth missing fields (${d.slug || d.label})`);
      seeSlug(d.slug, `depth:${d.slug}`);
      seeLabel(d.label, `depth:${d.slug}`);
      checkEx(d.examples, `depth:${d.slug}`);
    }
  }
  totalUmb += umb; totalIntro += intro; totalDepth += depth;
  perCat.push({ code, umbrellas: umb, intros: intro, in_depth: depth, rows: umb + intro + depth });
}

const extra = readdirSync(DIR).filter((f) => f.endsWith(".json"));
console.log("Per-category:");
for (const p of perCat) console.log(`  ${p.code.padEnd(4)} umb=${String(p.umbrellas).padStart(2)}  intro=${String(p.intros).padStart(2)}  in_depth=${String(p.in_depth).padStart(3)}  rows=${p.rows}`);
console.log(`\nTOTALS: umbrellas=${totalUmb}  intros=${totalIntro}  in_depth=${totalDepth}  ALL ROWS=${totalUmb + totalIntro + totalDepth}`);
console.log(`JSON files present: ${extra.length} (${extra.join(", ")})`);
console.log(`\n${errors.length === 0 ? "✅ NO ERRORS" : "❌ ERRORS (" + errors.length + "):"}`);
for (const e of errors) console.log("  - " + e);
