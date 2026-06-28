// Validate the 24 Chemistry/Physics taxonomy JSON files produced by the build agents.
// Plain node (no deps). Run: node scripts/validate-chemphys.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "mcat-chemphys-taxonomy");

// Expected header per code: { section, category_label, order_index }
const EXPECT = {
  P1:  { section: "physics",   label: "Kinematics & Translational Motion", order: 0 },
  P2:  { section: "physics",   label: "Forces & Newton's Laws", order: 1 },
  P3:  { section: "physics",   label: "Equilibrium, Torque & Center of Mass", order: 2 },
  P4:  { section: "physics",   label: "Work, Energy & Power", order: 3 },
  P5:  { section: "physics",   label: "Fluids", order: 4 },
  P6:  { section: "physics",   label: "Thermodynamics & Heat", order: 5 },
  P7:  { section: "physics",   label: "Periodic Motion, Waves & Sound", order: 6 },
  P8:  { section: "physics",   label: "Light & Geometrical Optics", order: 7 },
  P9:  { section: "physics",   label: "Electrostatics & Magnetism", order: 8 },
  P10: { section: "physics",   label: "Circuits", order: 9 },
  P11: { section: "physics",   label: "Atomic & Nuclear Phenomena", order: 10 },
  C1:  { section: "chemistry", label: "Atomic Structure & Periodic Trends", order: 0 },
  C2:  { section: "chemistry", label: "Bonding & Molecular Structure", order: 1 },
  C3:  { section: "chemistry", label: "Intermolecular Forces & Phases", order: 2 },
  C4:  { section: "chemistry", label: "Stoichiometry & Reaction Types", order: 3 },
  C5:  { section: "chemistry", label: "Gases & Solutions", order: 4 },
  C6:  { section: "chemistry", label: "Acids & Bases", order: 5 },
  C7:  { section: "chemistry", label: "Chemical Thermodynamics", order: 6 },
  C8:  { section: "chemistry", label: "Chemical Kinetics", order: 7 },
  C9:  { section: "chemistry", label: "Chemical Equilibrium", order: 8 },
  C10: { section: "chemistry", label: "Electrochemistry & Redox", order: 9 },
  C11: { section: "chemistry", label: "Organic Chemistry — Structure, Bonding & Stereochemistry", order: 10 },
  C12: { section: "chemistry", label: "Organic Chemistry — Reactions & Mechanisms", order: 11 },
  C13: { section: "chemistry", label: "Separations, Purification & Spectroscopy", order: 12 },
};
const CODES = Object.keys(EXPECT);

let totalUmb = 0, totalIntro = 0, totalDepth = 0;
const errors = [];
const perCat = [];
// Cross-file slug collision per section (keyword ids are <prefix>_<code>_<slug>; code differs so
// no real collision, but flag accidental same-id-within-code which would break seeding).

for (const code of CODES) {
  const path = join(DIR, `${code}.json`);
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    errors.push(`${code}: CANNOT PARSE — ${e.message}`);
    continue;
  }
  const exp = EXPECT[code];
  if (data.category_code !== code) errors.push(`${code}: category_code mismatch = ${data.category_code}`);
  if (data.section !== exp.section) errors.push(`${code}: section mismatch = ${data.section} (expected ${exp.section})`);
  if (data.category_label !== exp.label) errors.push(`${code}: category_label mismatch = "${data.category_label}" (expected "${exp.label}")`);
  if (data.order_index !== exp.order) errors.push(`${code}: order_index mismatch = ${data.order_index} (expected ${exp.order})`);
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
  perCat.push({ code, section: exp.section, umbrellas: umb, intros: intro, in_depth: depth, rows: umb + intro + depth });
}

const present = readdirSync(DIR).filter((f) => /^[CP]\d+\.json$/.test(f));
const missing = CODES.filter((c) => !present.includes(`${c}.json`));

console.log("Per-category:");
for (const p of perCat) console.log(`  ${p.code.padEnd(4)} [${p.section.padEnd(9)}] umb=${String(p.umbrellas).padStart(2)}  intro=${String(p.intros).padStart(2)}  in_depth=${String(p.in_depth).padStart(3)}  rows=${p.rows}`);
console.log(`\nTOTALS: umbrellas=${totalUmb}  intros=${totalIntro}  in_depth=${totalDepth}  ALL ROWS=${totalUmb + totalIntro + totalDepth}`);
console.log(`JSON files present: ${present.length}/${CODES.length}` + (missing.length ? `  MISSING: ${missing.join(", ")}` : ""));
console.log(`\n${errors.length === 0 ? "✅ NO ERRORS" : "❌ ERRORS (" + errors.length + "):"}`);
for (const e of errors) console.log("  - " + e);
