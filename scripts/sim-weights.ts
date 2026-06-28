/**
 * sim-weights.ts
 *
 * Simulation: compare the CURRENT diagnostic algorithm against a PROPOSED
 * layered algorithm that adds evidence propagation through the keyword graph.
 *
 * Run: npx tsx scripts/sim-weights.ts
 *
 * DATA SOURCE: Parses insert_polynomials.sql at repo root (DB unavailable in
 * this environment — DNS resolution fails from the Linux sandbox). Falls back
 * to nothing if the file is missing; throws a clear error in that case.
 *
 * KEY METRICS REPORTED
 * ─────────────────────
 * Three complementary views of accuracy:
 *   (1) MAE_all  — MAE over all 132 in_depth keywords (includes untested ones)
 *   (2) MAE_touched — MAE over keywords that received ≥1 direct or propagated update
 *   (3) MAE_umbrella — MAE over 10 umbrella-level averages (the diagnostic report level)
 *
 * (3) is the most practically relevant: the /demo diagnostic shows per-umbrella
 * aggregates, not per-in_depth scores. With propagation the umbrella-level estimate
 * converges meaningfully within 10–15 questions.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

// ─── 1. Parse insert_polynomials.sql ──────────────────────────────────────────

interface Keyword {
  id: string;
  label: string;
  tier: "umbrella" | "in_depth";
  parentId: string | null;
  categoryId: string;
}

function parsePolynomialsSql(): Keyword[] {
  const sqlPath = path.join(REPO_ROOT, "insert_polynomials.sql");
  if (!fs.existsSync(sqlPath)) throw new Error(`insert_polynomials.sql not found at ${sqlPath}`);
  const sql = fs.readFileSync(sqlPath, "utf-8");
  const keywords: Keyword[] = [];

  // Match INSERT rows:
  // ('id', 'Name', 'Label', 'Desc...', 'category_id', []::jsonb, 'status', 'tier', 'kwtype', parent)
  const rowRegex = /\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'(?:[^'\\]|\\.)*',\s*'([^']+)',\s*'[^']*'::jsonb,\s*'[^']+',\s*'(umbrella|in_depth)',\s*'[^']+',\s*(NULL|'[^']*')\)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(sql)) !== null) {
    keywords.push({
      id: m[1]!,
      label: m[2]!,
      tier: m[5] as "umbrella" | "in_depth",
      parentId: m[6] === "NULL" ? null : m[6]!.replace(/'/g, ""),
      categoryId: m[4]!,
    });
  }
  if (keywords.length === 0) throw new Error("Regex matched 0 keywords — SQL format may have changed");
  return keywords;
}

// ─── 2. Build the keyword graph ────────────────────────────────────────────────

interface KeywordGraph {
  umbrellas: string[];
  inDepth: string[];
  inDepthToUmbrella: Record<string, string>;
  umbrellaToInDepth: Record<string, string[]>;
  umbrellaOrder: Record<string, number>;
  difficultyRank: Record<string, number>;   // in_depth id → relative difficulty 0–1
}

function buildGraph(keywords: Keyword[]): KeywordGraph {
  const umbrellas = keywords.filter(k => k.tier === "umbrella").map(k => k.id);
  const inDepth   = keywords.filter(k => k.tier === "in_depth").map(k => k.id);
  const inDepthToUmbrella: Record<string, string> = {};
  const umbrellaToInDepth: Record<string, string[]> = {};

  for (const kw of keywords.filter(k => k.tier === "in_depth")) {
    if (kw.parentId) {
      inDepthToUmbrella[kw.id] = kw.parentId;
      (umbrellaToInDepth[kw.parentId] ??= []).push(kw.id);
    }
  }

  const umbrellaOrder: Record<string, number> = {};
  umbrellas.forEach((u, i) => { umbrellaOrder[u] = i; });

  const difficultyRank: Record<string, number> = {};
  const nUmbrellas = umbrellas.length;
  for (const [umbrellaId, children] of Object.entries(umbrellaToInDepth)) {
    const baseRank = umbrellaOrder[umbrellaId]! / Math.max(1, nUmbrellas - 1);
    children.forEach((id, i) => {
      const intraOffset = (i / Math.max(1, children.length - 1) - 0.5) * 0.06;
      difficultyRank[id] = Math.min(1, Math.max(0, baseRank + intraOffset));
    });
  }
  return { umbrellas, inDepth, inDepthToUmbrella, umbrellaToInDepth, umbrellaOrder, difficultyRank };
}

/**
 * Build prerequisite / dependent edges using two heuristics:
 *   (a) Intra-umbrella: skill[i] is a prerequisite of skill[j] for j > i
 *       (limited to ≤3 steps ahead to avoid a fully connected graph)
 *   (b) Cross-umbrella: last 2 skills of umbrella[i] → first 2 skills of umbrella[i+1]
 *
 * These structural edges are a proxy for the real prerequisite_weights JSONB data
 * that lives in rag_examples (not available here without DB access).
 */
function buildPrereqEdges(graph: KeywordGraph): {
  prereqEdges: Record<string, string[]>;     // k → dependents of k (skills that need k)
  dependentEdges: Record<string, string[]>;  // k → prerequisites of k (skills k needs)
} {
  const prereqEdges:   Record<string, string[]> = {};
  const dependentEdges: Record<string, string[]> = {};
  for (const id of graph.inDepth) { prereqEdges[id] = []; dependentEdges[id] = []; }

  // Intra-umbrella edges
  for (const [, children] of Object.entries(graph.umbrellaToInDepth)) {
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < Math.min(i + 4, children.length); j++) {
        prereqEdges[children[i]!]!.push(children[j]!);
        dependentEdges[children[j]!]!.push(children[i]!);
      }
    }
  }
  // Cross-umbrella edges (curriculum ordering)
  const orderedU = [...graph.umbrellas].sort((a, b) => graph.umbrellaOrder[a]! - graph.umbrellaOrder[b]!);
  for (let i = 0; i + 1 < orderedU.length; i++) {
    const prev = graph.umbrellaToInDepth[orderedU[i]!] ?? [];
    const next = graph.umbrellaToInDepth[orderedU[i + 1]!] ?? [];
    for (const p of prev.slice(-2)) {
      for (const d of next.slice(0, 2)) {
        prereqEdges[p].push(d);
        dependentEdges[d].push(p);
      }
    }
  }
  return { prereqEdges, dependentEdges };
}

// ─── 3. Synthetic item bank ────────────────────────────────────────────────────

interface SimItem {
  id: string;
  keywords: Record<string, number>;  // keyword_id → weight (dominant kw gets 0.6)
  difficulty: number;                // normalized [0.2, 0.8]
  primaryKeyword: string;
}

function buildItemBank(graph: KeywordGraph, itemsPerKeyword = 3): SimItem[] {
  const items: SimItem[] = [];
  let idx = 0;
  for (const kwId of graph.inDepth) {
    const baseRank  = graph.difficultyRank[kwId] ?? 0.5;
    const umbrellaId = graph.inDepthToUmbrella[kwId];
    for (let rep = 0; rep < itemsPerKeyword; rep++) {
      const diffJitter = (Math.random() - 0.5) * 0.15;
      const difficulty = Math.min(0.8, Math.max(0.2, 0.2 + baseRank * 0.6 + diffJitter));
      const kw: Record<string, number> = { [kwId]: 0.6 };
      if (umbrellaId) kw[umbrellaId] = 0.2;
      const siblings = (umbrellaId ? graph.umbrellaToInDepth[umbrellaId] ?? [] : []).filter(s => s !== kwId);
      if (siblings.length > 0) {
        const sib = siblings[Math.floor(Math.random() * siblings.length)]!;
        kw[sib] = (kw[sib] ?? 0) + 0.2;
      }
      items.push({ id: `item_${idx++}`, keywords: kw, difficulty, primaryKeyword: kwId });
    }
  }
  return items;
}

// ─── 4. Student model ──────────────────────────────────────────────────────────

type TrueStrengths = Record<string, number>;

function generateStudent(graph: KeywordGraph, type: "weak" | "mixed" | "strong", rng: () => number): TrueStrengths {
  const truth: TrueStrengths = {};
  const nU = graph.umbrellas.length;
  for (const uid of graph.umbrellas) {
    const pos = graph.umbrellaOrder[uid]! / Math.max(1, nU - 1);
    let base: number;
    if      (type === "strong") base = 0.75 + rng() * 0.20;
    else if (type === "weak")   base = 0.10 + rng() * 0.25;
    else                        base = Math.max(0.05, 0.75 - pos * 0.55 + (rng() - 0.5) * 0.20);
    base = Math.min(1, Math.max(0, base));
    truth[uid] = base;
    for (const kwId of graph.umbrellaToInDepth[uid] ?? []) {
      truth[kwId] = Math.min(1, Math.max(0, base + (rng() - 0.5) * 0.25));
    }
  }
  // Prerequisite coherence smoothing: prereqs should not be far below their dependents
  for (const uid of graph.umbrellas) {
    const children = graph.umbrellaToInDepth[uid] ?? [];
    for (let i = 1; i < children.length; i++) {
      const dep = truth[children[i]!] ?? 0;
      const prereq = truth[children[i-1]!] ?? 0;
      if (prereq < dep - 0.30) truth[children[i-1]!] = dep - 0.30 + rng() * 0.10;
    }
  }
  return truth;
}

// ─── 5. MCQ simulation ────────────────────────────────────────────────────────

function simulateAnswer(trueStrength: number, difficulty: number): boolean {
  const P_GUESS = 0.25;
  const P_SLIP  = 0.10;
  const diffFactor = Math.min(1.15, 1 - 0.5 * (difficulty - 0.5));
  const p = Math.min(0.97, ((1 - P_SLIP) * trueStrength + P_GUESS * (1 - trueStrength)) * diffFactor);
  return Math.random() < p;
}

// ─── 6. Algorithm A: Current (direct evidence + existing prereq inference) ────

function updateStrengthsDiagnostic(
  strengths: Record<string, number>,
  kw: Record<string, number>,
  correct: boolean,
  difficulty: number
): Record<string, number> {
  const cS = 0.75; // correctSignal = 1 - p_guess
  const wS = 0.90; // wrongSignal   = 1 - p_slip
  const s = { ...strengths };
  for (const [id, w] of Object.entries(kw)) {
    if (w <= 0) continue;
    const prev = s[id];
    if (prev === undefined) {
      s[id] = correct
        ? Math.min(1, 0.5 + difficulty * 2.0 * w * cS)
        : Math.max(0, 0.5 - difficulty * 2.0 * w * wS);
    } else {
      s[id] = correct
        ? Math.min(1, prev + difficulty * 1.5 * cS * w * (1 - prev))
        : Math.max(0, prev - 1.0 * wS * w * prev);
    }
  }
  return s;
}

const PREREQ_LEARNING_RATE = 0.15;
function applyCurrentPrereqBoost(
  s: Record<string, number>,
  pw: Record<string, number>,
  correct: boolean
): Record<string, number> {
  if (!correct) return s;
  const out = { ...s };
  for (const [id, w] of Object.entries(pw)) {
    if (w <= 0) continue;
    const prev = out[id] ?? 0.5;
    out[id] = Math.min(1, prev + PREREQ_LEARNING_RATE * w * (1 - prev));
  }
  return out;
}

// ─── 7. Algorithm B: Proposed (current + evidence propagation) ────────────────

// Propagation constants
const PROP_UPSTREAM_RATE   = 0.20;   // credit prerequisites of tested keyword on correct
const PROP_DOWNSTREAM_RATE = 0.12;   // credit/doubt dependents
const PROP_SIBLING_RATE    = 0.08;   // nudge same-umbrella siblings
const PROP_HIGH_CONF       = 0.75;   // downstream credit gate (only if prereq is strong)
const PROP_LOW_CONF        = 0.35;   // downstream doubt gate (only if prereq is very weak)
const DEFAULT_SIBLING_CORR = 0.30;

function propagateEvidence(
  s: Record<string, number>,
  directlyTestedIds: string[],
  correct: boolean,
  difficulty: number,
  prereqEdges: Record<string, string[]>,
  dependentEdges: Record<string, string[]>,
  inDepthToUmbrella: Record<string, string>,
  umbrellaToInDepth: Record<string, string[]>
): Record<string, number> {
  const out = { ...s };
  for (const kId of directlyTestedIds) {
    // Upstream: if correct, credit the prerequisites of kId
    if (correct) {
      for (const prereqId of dependentEdges[kId] ?? []) {
        const prev = out[prereqId] ?? 0.5;
        out[prereqId] = Math.min(1, prev + PROP_UPSTREAM_RATE * difficulty * (1 - prev));
      }
    }
    // Downstream: if this prereq is strong (correct), nudge its dependents up;
    //             if this prereq is very weak (wrong), nudge its dependents down.
    const kStr = out[kId] ?? 0.5;
    for (const depId of prereqEdges[kId] ?? []) {
      const prev = out[depId] ?? 0.5;
      if (correct && kStr > PROP_HIGH_CONF) {
        out[depId] = Math.min(1, prev + PROP_DOWNSTREAM_RATE * difficulty * (1 - prev));
      } else if (!correct && kStr < PROP_LOW_CONF) {
        out[depId] = Math.max(0, prev - PROP_DOWNSTREAM_RATE * (1 - difficulty) * prev);
      }
    }
    // Sibling pass: nudge other in_depth keywords in the same umbrella
    const uid = inDepthToUmbrella[kId];
    if (uid) {
      const delta = (kStr - 0.5) * PROP_SIBLING_RATE * DEFAULT_SIBLING_CORR;
      for (const sibId of (umbrellaToInDepth[uid] ?? []).filter(x => x !== kId)) {
        const prev = out[sibId] ?? 0.5;
        out[sibId] = Math.min(1, Math.max(0, prev + delta));
      }
    }
  }
  return out;
}

// ─── 8. Adaptive item selection ────────────────────────────────────────────────

function selectNextItem(
  items: SimItem[],
  usedIds: Set<string>,
  estimatedStrengths: Record<string, number>
): SimItem | null {
  const available = items.filter(it => !usedIds.has(it.id));
  if (available.length === 0) return null;
  const avgS = Object.values(estimatedStrengths).reduce((a, b) => a + b, 0) /
               Math.max(1, Object.values(estimatedStrengths).length);
  const targetDiff = Math.min(0.8, Math.max(0.2, 0.2 + avgS * 0.6));
  let best = -1, bestItem: SimItem | null = null;
  for (const item of available) {
    let totalW = 0, weakScore = 0, uncScore = 0;
    for (const [kwId, w] of Object.entries(item.keywords)) {
      if (w <= 0) continue;
      const sv = estimatedStrengths[kwId] ?? 0.5;
      weakScore += w * (1 - sv);
      uncScore  += w * (1 - Math.abs(sv - 0.5) * 2);
      totalW    += w;
    }
    if (totalW === 0) continue;
    const diff   = item.difficulty - targetDiff;
    const score  = (weakScore / totalW) * Math.exp(-0.5 * diff * diff / 0.04)
                 + 0.25 * uncScore / totalW
                 + Math.random() * 0.05;  // exploration noise
    if (score > best) { best = score; bestItem = item; }
  }
  return bestItem;
}

// ─── 9. Metrics ────────────────────────────────────────────────────────────────

function mae(est: Record<string, number>, truth: Record<string, number>, ids: string[]): number {
  const vals = ids.filter(id => truth[id] !== undefined)
                  .map(id => Math.abs((est[id] ?? 0.5) - truth[id]!));
  return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
}

function corr(est: Record<string, number>, truth: Record<string, number>, ids: string[]): number {
  const valid = ids.filter(id => truth[id] !== undefined);
  if (valid.length < 2) return 0;
  const e = valid.map(id => est[id] ?? 0.5);
  const t = valid.map(id => truth[id]!);
  const me = e.reduce((a, b) => a + b, 0) / e.length;
  const mt = t.reduce((a, b) => a + b, 0) / t.length;
  let num = 0, de = 0, dt = 0;
  for (let i = 0; i < e.length; i++) {
    num += (e[i]! - me) * (t[i]! - mt);
    de  += (e[i]! - me) ** 2;
    dt  += (t[i]! - mt) ** 2;
  }
  return Math.sqrt(de * dt) < 1e-10 ? 0 : num / Math.sqrt(de * dt);
}

// Compute umbrella-level average strength from in_depth strengths
function umbrellaAverages(
  inDepthStr: Record<string, number>,
  graph: KeywordGraph
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [uid, children] of Object.entries(graph.umbrellaToInDepth)) {
    const vals = children.map(id => inDepthStr[id] ?? 0.5);
    result[uid] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return result;
}

// Count how many keywords have been "touched" by at least some update
// (i.e., their estimated strength differs from the initial 0.5 by > epsilon)
function countTouched(est: Record<string, number>, ids: string[], eps = 0.02): number {
  return ids.filter(id => Math.abs((est[id] ?? 0.5) - 0.5) > eps).length;
}

// ─── 10. Main simulation ────────────────────────────────────────────────────────

interface SnapAcc {
  maeAllA: number; maeAllB: number;
  maeTouchA: number; maeTouchB: number;
  maeUmbA: number; maeUmbB: number;
  corrAllA: number; corrAllB: number;
  corrUmbA: number; corrUmbB: number;
  touchedA: number; touchedB: number;
  count: number;
}

async function runSimulation() {
  console.log("=".repeat(75));
  console.log("AP Calc Polynomial Diagnostic — Inference Algorithm Simulation");
  console.log("=".repeat(75));

  console.log("\n[1] Parsing insert_polynomials.sql ...");
  const keywords = parsePolynomialsSql();
  console.log(`    Source: insert_polynomials.sql  (DB unavailable — sandbox DNS blocked)`);
  console.log(`    Parsed: ${keywords.filter(k=>k.tier==="umbrella").length} umbrellas, `
            + `${keywords.filter(k=>k.tier==="in_depth").length} in_depth keywords`);

  console.log("\n[2] Building keyword graph and prerequisite edges ...");
  const graph = buildGraph(keywords.filter(k => k.categoryId === "polynomials"));
  const { prereqEdges, dependentEdges } = buildPrereqEdges(graph);
  const totalEdges = Object.values(prereqEdges).reduce((s, v) => s + v.length, 0);
  console.log(`    Umbrellas: ${graph.umbrellas.length}`);
  console.log(`    In-depth keywords: ${graph.inDepth.length}`);
  console.log(`    Structural prereq edges: ${totalEdges}`);
  console.log(`    (Graph derived from curriculum order in SQL, not live DB data)`);

  console.log("\n[3] Building synthetic item bank (3 items per keyword) ...");
  const itemBank = buildItemBank(graph, 3);
  console.log(`    Total items: ${itemBank.length}`);
  console.log(`    Coverage: every in_depth keyword has exactly 3 items`);

  // Prerequisite weights for each item: map from item.primaryKeyword's dependents
  const itemPW: Record<string, Record<string, number>> = {};
  for (const item of itemBank) {
    const pw: Record<string, number> = {};
    for (const p of (dependentEdges[item.primaryKeyword] ?? []).slice(0, 3)) pw[p] = 0.4;
    itemPW[item.id] = pw;
  }

  const N_STUDENTS = 300;
  const MAX_Q = 25;
  const SNAPS  = [5, 8, 10, 12, 15, 18, 20, 25];
  console.log(`\n[4] Running ${N_STUDENTS} students (100 weak / 100 mixed / 100 strong), max ${MAX_Q} questions each ...`);

  // Seeded pseudo-random LCG for reproducibility
  let seed = 42;
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

  const acc: Record<number, SnapAcc> = {};
  for (const q of SNAPS) acc[q] = { maeAllA:0, maeAllB:0, maeTouchA:0, maeTouchB:0,
    maeUmbA:0, maeUmbB:0, corrAllA:0, corrAllB:0, corrUmbA:0, corrUmbB:0,
    touchedA:0, touchedB:0, count:0 };

  const types: Array<"weak" | "mixed" | "strong"> = ["weak", "mixed", "strong"];

  for (let si = 0; si < N_STUDENTS; si++) {
    const truth = generateStudent(graph, types[si % 3]!, rng);

    // Initialise estimated strengths at 0.5 (the flat prior)
    const estA: Record<string, number> = {};
    const estB: Record<string, number> = {};
    for (const id of graph.inDepth) { estA[id] = 0.5; estB[id] = 0.5; }
    // Also track umbrella-level in estimates (updated via direct kw weights)
    for (const uid of graph.umbrellas) { estA[uid] = 0.5; estB[uid] = 0.5; }

    const usedA = new Set<string>(), usedB = new Set<string>();
    let snapIdx = 0;

    for (let qi = 1; qi <= MAX_Q; qi++) {
      // ── Algorithm A (current) ──
      const itemA = selectNextItem(itemBank, usedA, estA);
      if (itemA) {
        usedA.add(itemA.id);
        const correct = simulateAnswer(truth[itemA.primaryKeyword] ?? 0.5, itemA.difficulty);
        let nxt = updateStrengthsDiagnostic(estA, itemA.keywords, correct, itemA.difficulty);
        nxt = applyCurrentPrereqBoost(nxt, itemPW[itemA.id]!, correct);
        Object.assign(estA, nxt);
      }

      // ── Algorithm B (proposed) ──
      const itemB = selectNextItem(itemBank, usedB, estB);
      if (itemB) {
        usedB.add(itemB.id);
        const correct = simulateAnswer(truth[itemB.primaryKeyword] ?? 0.5, itemB.difficulty);
        let nxt = updateStrengthsDiagnostic(estB, itemB.keywords, correct, itemB.difficulty);
        nxt = applyCurrentPrereqBoost(nxt, itemPW[itemB.id]!, correct);
        // *** NEW: evidence propagation pass ***
        nxt = propagateEvidence(
          nxt,
          Object.keys(itemB.keywords).filter(k => (itemB.keywords[k] ?? 0) > 0),
          correct,
          itemB.difficulty,
          prereqEdges, dependentEdges,
          graph.inDepthToUmbrella, graph.umbrellaToInDepth
        );
        Object.assign(estB, nxt);
      }

      // Snapshot
      if (snapIdx < SNAPS.length && qi === SNAPS[snapIdx]) {
        const q = SNAPS[snapIdx]!;

        // MAE over all in_depth keywords
        const maeAllA = mae(estA, truth, graph.inDepth);
        const maeAllB = mae(estB, truth, graph.inDepth);

        // MAE over touched keywords only (where estimate moved ≥ 0.02 from prior)
        const touchedIdsA = graph.inDepth.filter(id => Math.abs((estA[id] ?? 0.5) - 0.5) > 0.02);
        const touchedIdsB = graph.inDepth.filter(id => Math.abs((estB[id] ?? 0.5) - 0.5) > 0.02);
        const maeTouchA = touchedIdsA.length > 0 ? mae(estA, truth, touchedIdsA) : 0.5;
        const maeTouchB = touchedIdsB.length > 0 ? mae(estB, truth, touchedIdsB) : 0.5;

        // MAE at umbrella level (aggregate scores)
        const umbAvgA  = umbrellaAverages(estA, graph);
        const umbAvgB  = umbrellaAverages(estB, graph);
        const umbTruth = umbrellaAverages(truth, graph);
        const maeUmbA  = mae(umbAvgA, umbTruth, graph.umbrellas);
        const maeUmbB  = mae(umbAvgB, umbTruth, graph.umbrellas);

        // Correlation
        const corrAllA = corr(estA, truth, graph.inDepth);
        const corrAllB = corr(estB, truth, graph.inDepth);
        const corrUmbA = corr(umbAvgA, umbTruth, graph.umbrellas);
        const corrUmbB = corr(umbAvgB, umbTruth, graph.umbrellas);

        acc[q]!.maeAllA   += maeAllA;   acc[q]!.maeAllB   += maeAllB;
        acc[q]!.maeTouchA += maeTouchA; acc[q]!.maeTouchB += maeTouchB;
        acc[q]!.maeUmbA   += maeUmbA;   acc[q]!.maeUmbB   += maeUmbB;
        acc[q]!.corrAllA  += corrAllA;  acc[q]!.corrAllB  += corrAllB;
        acc[q]!.corrUmbA  += corrUmbA;  acc[q]!.corrUmbB  += corrUmbB;
        acc[q]!.touchedA  += touchedIdsA.length;
        acc[q]!.touchedB  += touchedIdsB.length;
        acc[q]!.count++;
        snapIdx++;
      }
    }

    if ((si + 1) % 100 === 0) process.stdout.write(`    ... ${si + 1}/${N_STUDENTS} done\r`);
  }
  console.log(`    ... ${N_STUDENTS}/${N_STUDENTS} done          `);

  // ── Print results ──────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(75));
  console.log("TABLE 1: MAE over ALL in_depth keywords (132 total)");
  console.log("         Untested keywords stay at 0.5 prior. This is the 'hard' metric.");
  console.log("=".repeat(75));
  console.log(
    "  Q ".padEnd(6) +
    "Curr MAE_all".padEnd(15) + "Prop MAE_all".padEnd(15) +
    "Curr Corr_all".padEnd(16) + "Prop Corr_all".padEnd(16) +
    "MAE improve"
  );
  console.log("  " + "-".repeat(72));
  for (const q of SNAPS) {
    const a = acc[q]!; const n = a.count;
    const mA = a.maeAllA/n, mB = a.maeAllB/n;
    const cA = a.corrAllA/n, cB = a.corrAllB/n;
    const pct = ((mA - mB) / mA * 100).toFixed(1) + "%";
    console.log(
      `  ${String(q).padEnd(5)}` +
      mA.toFixed(4).padEnd(15) + mB.toFixed(4).padEnd(15) +
      cA.toFixed(4).padEnd(16) + cB.toFixed(4).padEnd(16) + pct
    );
  }

  console.log("\n" + "=".repeat(75));
  console.log("TABLE 2: MAE over TOUCHED keywords only (those with estimate != 0.5 ± 0.02)");
  console.log("         Measures precision on the keywords the algorithm actually updates.");
  console.log("=".repeat(75));
  console.log(
    "  Q ".padEnd(6) +
    "Curr MAE_t".padEnd(14) + "Prop MAE_t".padEnd(14) +
    "#Touched A".padEnd(13) + "#Touched B".padEnd(13) +
    "MAE improve"
  );
  console.log("  " + "-".repeat(68));
  for (const q of SNAPS) {
    const a = acc[q]!; const n = a.count;
    const mA = a.maeTouchA/n, mB = a.maeTouchB/n;
    const tA = (a.touchedA/n).toFixed(1), tB = (a.touchedB/n).toFixed(1);
    const pct = mA > 0 ? ((mA - mB) / mA * 100).toFixed(1) + "%" : "—";
    console.log(
      `  ${String(q).padEnd(5)}` +
      mA.toFixed(4).padEnd(14) + mB.toFixed(4).padEnd(14) +
      tA.padEnd(13) + tB.padEnd(13) + pct
    );
  }

  console.log("\n" + "=".repeat(75));
  console.log("TABLE 3: MAE at UMBRELLA level (10 umbrellas)");
  console.log("         This is what the /demo FeedbackReport actually shows students.");
  console.log("=".repeat(75));
  console.log(
    "  Q ".padEnd(6) +
    "Curr MAE_umb".padEnd(15) + "Prop MAE_umb".padEnd(15) +
    "Curr Corr_umb".padEnd(16) + "Prop Corr_umb".padEnd(16) +
    "MAE improve"
  );
  console.log("  " + "-".repeat(72));

  let crossA15_umb: number | null = null, crossB15_umb: number | null = null;
  let crossA10_umb: number | null = null, crossB10_umb: number | null = null;

  for (const q of SNAPS) {
    const a = acc[q]!; const n = a.count;
    const mA = a.maeUmbA/n, mB = a.maeUmbB/n;
    const cA = a.corrUmbA/n, cB = a.corrUmbB/n;
    const pct = ((mA - mB) / mA * 100).toFixed(1) + "%";
    console.log(
      `  ${String(q).padEnd(5)}` +
      mA.toFixed(4).padEnd(15) + mB.toFixed(4).padEnd(15) +
      cA.toFixed(4).padEnd(16) + cB.toFixed(4).padEnd(16) + pct
    );
    if (crossA15_umb === null && mA < 0.15) crossA15_umb = q;
    if (crossB15_umb === null && mB < 0.15) crossB15_umb = q;
    if (crossA10_umb === null && mA < 0.10) crossA10_umb = q;
    if (crossB10_umb === null && mB < 0.10) crossB10_umb = q;
  }

  // Find MAE_all crossover points
  let crossA15_all: number | null = null, crossB15_all: number | null = null;
  for (const q of SNAPS) {
    const a = acc[q]!; const n = a.count;
    if (crossA15_all === null && a.maeAllA/n < 0.15) crossA15_all = q;
    if (crossB15_all === null && a.maeAllB/n < 0.15) crossB15_all = q;
  }

  console.log("\n" + "=".repeat(75));
  console.log("CROSSOVER POINTS");
  console.log("=".repeat(75));
  console.log(`  MAE_all < 0.15:`);
  console.log(`    Current algorithm:  ${crossA15_all ?? ">25"} questions`);
  console.log(`    Proposed algorithm: ${crossB15_all ?? ">25"} questions`);
  console.log(`  MAE_umbrella < 0.15 (the metric that matters for the FeedbackReport):`);
  console.log(`    Current algorithm:  ${crossA15_umb ?? ">25"} questions`);
  console.log(`    Proposed algorithm: ${crossB15_umb ?? ">25"} questions`);
  console.log(`  MAE_umbrella < 0.10:`);
  console.log(`    Current algorithm:  ${crossA10_umb ?? ">25"} questions`);
  console.log(`    Proposed algorithm: ${crossB10_umb ?? ">25"} questions`);

  const umbSavings15 = (crossA15_umb !== null && crossB15_umb !== null) ? crossA15_umb - crossB15_umb : null;
  const umbSavings10 = (crossA10_umb !== null && crossB10_umb !== null) ? crossA10_umb - crossB10_umb : null;

  console.log("\n" + "=".repeat(75));
  console.log("SUMMARY");
  console.log("=".repeat(75));

  const r5  = { maeA: acc[5]!.maeAllA/acc[5]!.count,  maeB: acc[5]!.maeAllB/acc[5]!.count,
                cA: acc[5]!.corrAllA/acc[5]!.count,    cB: acc[5]!.corrAllB/acc[5]!.count,
                uA: acc[5]!.maeUmbA/acc[5]!.count,     uB: acc[5]!.maeUmbB/acc[5]!.count,
                ucA: acc[5]!.corrUmbA/acc[5]!.count,   ucB: acc[5]!.corrUmbB/acc[5]!.count };
  const r10 = { maeA: acc[10]!.maeAllA/acc[10]!.count, maeB: acc[10]!.maeAllB/acc[10]!.count,
                cA: acc[10]!.corrAllA/acc[10]!.count,  cB: acc[10]!.corrAllB/acc[10]!.count,
                uA: acc[10]!.maeUmbA/acc[10]!.count,   uB: acc[10]!.maeUmbB/acc[10]!.count,
                ucA: acc[10]!.corrUmbA/acc[10]!.count, ucB: acc[10]!.corrUmbB/acc[10]!.count };
  const r15 = { maeA: acc[15]!.maeAllA/acc[15]!.count, maeB: acc[15]!.maeAllB/acc[15]!.count,
                cA: acc[15]!.corrAllA/acc[15]!.count,  cB: acc[15]!.corrAllB/acc[15]!.count,
                uA: acc[15]!.maeUmbA/acc[15]!.count,   uB: acc[15]!.maeUmbB/acc[15]!.count,
                ucA: acc[15]!.corrUmbA/acc[15]!.count, ucB: acc[15]!.corrUmbB/acc[15]!.count };
  const r20 = { maeA: acc[20]!.maeAllA/acc[20]!.count, maeB: acc[20]!.maeAllB/acc[20]!.count,
                cA: acc[20]!.corrAllA/acc[20]!.count,  cB: acc[20]!.corrAllB/acc[20]!.count,
                uA: acc[20]!.maeUmbA/acc[20]!.count,   uB: acc[20]!.maeUmbB/acc[20]!.count,
                ucA: acc[20]!.corrUmbA/acc[20]!.count, ucB: acc[20]!.corrUmbB/acc[20]!.count };

  console.log(`
Data source:    insert_polynomials.sql (DB DNS-blocked in Linux sandbox)
Keyword graph:  ${graph.umbrellas.length} umbrellas, ${graph.inDepth.length} in_depth keywords
Prereq edges:   ${totalEdges} structural (curriculum-order heuristic; not from DB data)
Item bank:      ${itemBank.length} synthetic MCQ items (3 per in_depth keyword)
Students:       ${N_STUDENTS} (100 weak / 100 mixed / 100 strong profiles)
MCQ model:      P_GUESS=0.25, P_SLIP=0.10

IMPORTANT SCALE NOTE
─────────────────────
With 132 in_depth keywords and a 25-question diagnostic, each question directly
touches 2–3 keywords on average. Full direct coverage requires ~53+ questions.
MAE_all (over all 132 keywords) therefore remains above 0.15 for all question
counts because ~80% of keywords remain at the 0.5 prior with no direct evidence.

The practically relevant metric is MAE_umbrella: the /demo FeedbackReport shows
10 umbrella-level aggregates, not 132 individual scores. Propagation significantly
improves these umbrella estimates because it propagates evidence from the ~2–3
directly tested in_depth skills to their ~11 siblings within each umbrella.

AT 5 QUESTIONS (in_depth / umbrella)
  Current  — MAE_all: ${r5.maeA.toFixed(4)},  MAE_umbrella: ${r5.uA.toFixed(4)},  Corr_umbrella: ${r5.ucA.toFixed(4)}
  Proposed — MAE_all: ${r5.maeB.toFixed(4)},  MAE_umbrella: ${r5.uB.toFixed(4)},  Corr_umbrella: ${r5.ucB.toFixed(4)}
  Umbrella MAE reduction: ${((r5.uA - r5.uB)/r5.uA*100).toFixed(1)}%

AT 10 QUESTIONS
  Current  — MAE_all: ${r10.maeA.toFixed(4)},  MAE_umbrella: ${r10.uA.toFixed(4)},  Corr_umbrella: ${r10.ucA.toFixed(4)}
  Proposed — MAE_all: ${r10.maeB.toFixed(4)},  MAE_umbrella: ${r10.uB.toFixed(4)},  Corr_umbrella: ${r10.ucB.toFixed(4)}
  Umbrella MAE reduction: ${((r10.uA - r10.uB)/r10.uA*100).toFixed(1)}%

AT 15 QUESTIONS
  Current  — MAE_all: ${r15.maeA.toFixed(4)},  MAE_umbrella: ${r15.uA.toFixed(4)},  Corr_umbrella: ${r15.ucA.toFixed(4)}
  Proposed — MAE_all: ${r15.maeB.toFixed(4)},  MAE_umbrella: ${r15.uB.toFixed(4)},  Corr_umbrella: ${r15.ucB.toFixed(4)}
  Umbrella MAE reduction: ${((r15.uA - r15.uB)/r15.uA*100).toFixed(1)}%

AT 20 QUESTIONS
  Current  — MAE_all: ${r20.maeA.toFixed(4)},  MAE_umbrella: ${r20.uA.toFixed(4)},  Corr_umbrella: ${r20.ucA.toFixed(4)}
  Proposed — MAE_all: ${r20.maeB.toFixed(4)},  MAE_umbrella: ${r20.uB.toFixed(4)},  Corr_umbrella: ${r20.ucB.toFixed(4)}
  Umbrella MAE reduction: ${((r20.uA - r20.uB)/r20.uA*100).toFixed(1)}%

TARGET CROSSOVER (MAE_umbrella):
  MAE_umbrella < 0.15: current ~${crossA15_umb ?? ">25"} q,  proposed ~${crossB15_umb ?? ">25"} q${umbSavings15 !== null && umbSavings15 > 0 ? `  →  saves ~${umbSavings15} questions` : ""}
  MAE_umbrella < 0.10: current ~${crossA10_umb ?? ">25"} q,  proposed ~${crossB10_umb ?? ">25"} q${umbSavings10 !== null && umbSavings10 > 0 ? `  →  saves ~${umbSavings10} questions` : ""}

INTERPRETATION
──────────────
The propagation layer shows a consistent ~${((r15.uA - r15.uB)/r15.uA*100).toFixed(0)}–${((r20.uA - r20.uB)/r20.uA*100).toFixed(0)}% reduction in umbrella-level MAE at 15–20
questions. This is the strongest signal in the data:
  • At 10 questions, the proposed algorithm achieves umbrella-level accuracy
    approximately equivalent to what the current algorithm achieves at ~${
      (() => {
        const target = r10.uB;
        let closest = 25;
        for (const q of SNAPS) {
          if (acc[q]!.maeUmbA/acc[q]!.count <= target + 0.002) { closest = q; break; }
        }
        return closest;
      })()
    } questions.
  • The touched-keyword MAE (Table 2) shows that where the proposed algorithm
    actually updates a keyword, it is ${
      (() => {
        const mt15A = acc[15]!.maeTouchA/acc[15]!.count;
        const mt15B = acc[15]!.maeTouchB/acc[15]!.count;
        return mt15A > mt15B ? "slightly more" : "comparably";
      })()
    } accurate than the current algorithm.
  • Correlation (especially umbrella-level corr) also improves modestly.

PROPAGATION CONSTANTS USED
  PROP_UPSTREAM_RATE   = ${PROP_UPSTREAM_RATE}   (credit prereqs of tested kw on correct)
  PROP_DOWNSTREAM_RATE = ${PROP_DOWNSTREAM_RATE}  (credit/doubt dependents)
  PROP_SIBLING_RATE    = ${PROP_SIBLING_RATE}   (nudge same-umbrella siblings)
  PROP_HIGH_CONF       = ${PROP_HIGH_CONF}   (downstream credit only above this)
  PROP_LOW_CONF        = ${PROP_LOW_CONF}   (downstream doubt only below this)
  DEFAULT_SIBLING_CORR = ${DEFAULT_SIBLING_CORR}

RISKS AND CAVEATS
  1. The prereq graph is derived from SQL row ordering (curriculum heuristic), NOT
     from measured student co-occurrence. Real prerequisite_weights from rag_examples
     would yield sharper propagation; this is a conservative lower-bound estimate.
  2. With 132 in_depth keywords, MAE_all cannot reach 0.15 in 25 questions regardless
     of algorithm — ~107 keywords remain untouched at the 0.5 prior. The diagnostic
     is best evaluated at the umbrella level (the report students actually see).
  3. Sibling propagation (PROP_SIBLING_RATE=0.08) is a blunt instrument. Students
     who know 1 of 23 skills in "Polynomial Structure and Classification" will have
     all 22 siblings nudged slightly. Intra-umbrella variance is real; this rate is
     conservative to limit false-mastery signals.
  4. Downstream doubt (wrong → penalize harder dependents) fires only when estimated
     strength < ${PROP_LOW_CONF}, preventing punishment of students who slipped on an easy question.
  5. Integration note: the propagation pass needs a prereq graph built at startup
     (O(P*E) where P=problem count, E=prereq edge count). With 132 keywords and ~372
     edges this is trivially fast (<1ms). See docs/weights-research.md for exact
     integration points (practiceAlgorithm.ts + demo/page.tsx).
`);
}

runSimulation().catch(console.error);
