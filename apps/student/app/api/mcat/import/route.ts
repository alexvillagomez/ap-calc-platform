/**
 * POST /api/mcat/import
 *
 * Anki deck (.apkg) import: parse → retention → keyword match → cap-seed ability.
 *
 * Multipart form fields:
 *   session_id  (text)   Student session id.
 *   section     (text)   MCAT section ("biology" | "psych_soc" | "physics" | "chemistry").
 *   file        (File)   The .apkg file.
 *
 * Response:
 *   { cards_parsed, cards_matched, cards_dropped, keywords_seeded }
 *
 * PRIVACY CONTRACT: card text, fields, tags, and media are NEVER persisted
 * anywhere — they are parsed and embedded in memory then immediately discarded.
 * Only the aggregated per-keyword ability seeds are written to the DB.
 *
 * NOTE for Vercel deploy: sql.js loads its WebAssembly binary via
 * `require.resolve('sql.js/dist/sql-wasm.wasm')` + `fs.readFileSync`.
 * In local dev this works out of the box. On Vercel the .wasm file may need
 * to be included in the output bundle via `outputFileTracingIncludes` in
 * next.config.ts — but do NOT change next.config until ready to deploy.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";

// webpack's built-in escape hatch: a plain runtime require() that is NOT statically
// analyzed or rewritten. Needed to load sql.js's pure-JS asm build by absolute path.
declare const __non_webpack_require__: NodeRequire;
import { unzipSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";
// sql.js is loaded via RUNTIME require (below), not a static import — the ESM
// default-interop wrapper under serverExternalPackages was dropping our config
// (wasmBinary/locateFile), so Emscripten fell back to a relative wasm fetch.
import type initSqlJsType from "sql.js";
import { embedText } from "@/lib/mcatTagging";
import { MCAT_SECTION_ORDER, type McatSection } from "@/lib/mcatSection";
import { seedKeywordProgress } from "@/lib/mcatSeedProgress";

export const runtime = "nodejs";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum unique cards to embed (cost + latency guard). */
const MAX_CARDS_TO_EMBED = 1500;

/** Minimum cosine similarity to count a card→keyword match. */
const MATCH_THRESHOLD = 0.30;

/** Number of keyword matches to request per card embedding. */
const MATCH_COUNT = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Zstd magic bytes: 0xFD 0x2F 0xB5 0x28 (little-endian in file = 28 B5 2F FD). */
function isZstd(buf: Uint8Array): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x28 &&
    buf[1] === 0xb5 &&
    buf[2] === 0x2f &&
    buf[3] === 0xfd
  );
}

/** Strip HTML tags and Anki-specific markers from card field text. */
function stripHtml(raw: string): string {
  return raw
    // Remove <img ...> tags entirely (image-only content)
    .replace(/<img[^>]*>/gi, " ")
    // Remove [sound:...] markers
    .replace(/\[sound:[^\]]*\]/gi, " ")
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute a card's retention score [0–1] from its Anki scheduling data.
 *
 * FSRS (Anki 23.10+): `cards.data` contains a JSON blob with stability `s`,
 * difficulty `d`, and optionally a retrievability `r`. If `r` is present, use
 * it directly. Otherwise treat a high-stability card conservatively as ~0.9.
 *
 * SM-2 (older Anki): use interval + lapses.
 *   - New card (type === 0) or suspended (queue < 0) → 0 (no evidence).
 *   - Else: log-mapped interval (181 days ≈ 1.0), lapse penalty −0.03 each.
 */
function computeRetention(card: {
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  queue: number;
  type: number;
  data: string;
}): number {
  // Try FSRS data first.
  if (card.data) {
    try {
      const parsed = JSON.parse(card.data) as Record<string, unknown>;
      // Direct retrievability field (some FSRS builds emit it).
      if (typeof parsed.r === "number" && parsed.r > 0) {
        return Math.min(1, parsed.r);
      }
      // High-stability heuristic: if stability exists, treat as known but
      // cap conservatively (FSRS ≠ problem-solving ability).
      if (typeof parsed.s === "number" && parsed.s > 0) {
        return 0.9;
      }
    } catch {
      // Malformed data — fall through to SM-2.
    }
  }

  // SM-2 path.
  // New cards or suspended cards have no retention evidence.
  if (card.queue < 0 || card.type === 0) return 0;
  // Log-mapped interval: 1-day = ~0, 181-day = 1.0.
  const ivlScore = Math.min(
    1,
    Math.log(Math.max(0, card.ivl) + 1) / Math.log(181)
  );
  const lapsePenalty = 0.03 * Math.max(0, card.lapses);
  return Math.max(0, ivlScore - lapsePenalty);
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  // ── Parse form data ──────────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Could not parse multipart form data" },
      { status: 400 }
    );
  }

  const session_id = formData.get("session_id");
  const section = formData.get("section");
  const file = formData.get("file");

  if (!session_id || typeof session_id !== "string") {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }
  if (
    !section ||
    typeof section !== "string" ||
    !MCAT_SECTION_ORDER.includes(section as McatSection)
  ) {
    return NextResponse.json(
      {
        error: `section is required and must be one of: ${MCAT_SECTION_ORDER.join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "file (.apkg) is required" },
      { status: 400 }
    );
  }

  // ── Load + unzip the .apkg ───────────────────────────────────────────────────
  let zipBytes: Uint8Array;
  try {
    zipBytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not read uploaded file: ${msg}` },
      { status: 400 }
    );
  }

  let unzipped: ReturnType<typeof unzipSync>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `File does not appear to be a valid .apkg (zip): ${msg}` },
      { status: 400 }
    );
  }

  // Pick the SQLite entry in preference order.
  const sqliteEntry =
    unzipped["collection.anki21b"] ??
    unzipped["collection.anki21"] ??
    unzipped["collection.anki2"];

  if (!sqliteEntry) {
    return NextResponse.json(
      {
        error:
          "No Anki collection found inside the .apkg. Expected collection.anki21b, collection.anki21, or collection.anki2.",
      },
      { status: 400 }
    );
  }

  // ── Decompress if needed ─────────────────────────────────────────────────────
  let sqliteBytes: Uint8Array;
  const isAnki21b = "collection.anki21b" in unzipped;
  if (isAnki21b || isZstd(sqliteEntry)) {
    try {
      sqliteBytes = zstdDecompress(sqliteEntry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Failed to decompress zstd collection: ${msg}` },
        { status: 400 }
      );
    }
  } else {
    sqliteBytes = sqliteEntry;
  }

  // ── Open SQLite with sql.js ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  try {
    // Use sql.js's PURE-JS asm.js build (sql-asm.js) — SQLite embedded entirely in
    // JS, NO .wasm file. The wasm build's Emscripten loader breaks inside the Next
    // server bundle (ignores wasmBinary/locateFile, fetches a relative wasm → ENOENT),
    // so we load the asm build by absolute path via a runtime require (webpack never
    // sees it; sql.js stays externalized in next.config). Slower but reliable.
    // __non_webpack_require__ emits a PLAIN runtime require() that webpack never
    // rewrites. (Plain createRequire(...).resolve("sql.js") was rewritten by webpack
    // to the bare external id "sql.js", so the path lookup failed.)
    const sqlJsDir = path.dirname(__non_webpack_require__.resolve("sql.js"));
    const initSqlJs = __non_webpack_require__(path.join(sqlJsDir, "sql-asm.js")) as typeof initSqlJsType;
    const SQL = await initSqlJs({});
    db = new SQL.Database(sqliteBytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mcat/import] sql.js init failed:", msg);
    return NextResponse.json(
      { error: `Could not open Anki database: ${msg}` },
      { status: 400 }
    );
  }

  // ── Query notes + cards ──────────────────────────────────────────────────────
  type NoteRow = { id: number; flds: string; tags: string };
  type CardRow = {
    nid: number;
    ivl: number;
    factor: number;
    reps: number;
    lapses: number;
    queue: number;
    type: number;
    data: string;
  };

  let noteRows: NoteRow[] = [];
  let cardRows: CardRow[] = [];

  try {
    const noteRes = db.exec("SELECT id, flds, tags FROM notes");
    if (noteRes.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noteRows = noteRes[0].values.map((v: any[]) => ({
        id: v[0] as number,
        flds: v[1] as string,
        tags: v[2] as string,
      }));
    }

    const cardRes = db.exec(
      "SELECT nid, ivl, factor, reps, lapses, queue, type, data FROM cards"
    );
    if (cardRes.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cardRows = cardRes[0].values.map((v: any[]) => ({
        nid: v[0] as number,
        ivl: v[1] as number,
        factor: v[2] as number,
        reps: v[3] as number,
        lapses: v[4] as number,
        queue: v[5] as number,
        type: v[6] as number,
        data: v[7] as string,
      }));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to read Anki collection tables: ${msg}` },
      { status: 400 }
    );
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }

  // ── Build card records (note fields + tags + retention) ──────────────────────
  const noteMap = new Map<number, NoteRow>(noteRows.map((n) => [n.id, n]));

  type CardRecord = { text: string; retention: number };
  // Deduplicate by match text — identical text in different cards adds no new signal.
  const textToRetention = new Map<string, number[]>();

  for (const card of cardRows) {
    const note = noteMap.get(card.nid);
    if (!note) continue;

    // Build text-only match string: all note fields + tags.
    const fields = note.flds.split("\x1f").map(stripHtml).join(" ");
    const tags = note.tags.replace(/\s+/g, " ").trim();
    const raw = `${fields} ${tags}`.trim();

    // Drop effectively-empty cards (after stripping all HTML/media).
    if (raw.length < 3) continue;

    const retention = computeRetention(card);
    const existing = textToRetention.get(raw);
    if (existing) {
      existing.push(retention);
    } else {
      textToRetention.set(raw, [retention]);
    }
  }

  const cards_parsed = cardRows.length;

  // Unique match texts — cap at MAX_CARDS_TO_EMBED.
  const uniqueTexts: CardRecord[] = [];
  let dropped_cap = 0;
  for (const [text, retentions] of textToRetention.entries()) {
    if (uniqueTexts.length >= MAX_CARDS_TO_EMBED) {
      dropped_cap++;
      continue;
    }
    // Average retention across duplicate cards with the same text.
    const avgRetention =
      retentions.reduce((s, r) => s + r, 0) / retentions.length;
    uniqueTexts.push({ text, retention: avgRetention });
  }

  if (dropped_cap > 0) {
    console.log(
      `[mcat/import] capped at ${MAX_CARDS_TO_EMBED} unique cards; dropped ${dropped_cap} further unique texts`
    );
  }

  // ── Embed + match keywords ───────────────────────────────────────────────────
  const supabase = createClient(supabaseUrl, key);

  // Per-keyword accumulator: list of (similarity × retention) values.
  const kwScores = new Map<string, number[]>();
  let cards_matched = 0;
  let cards_dropped = 0;

  for (const { text, retention } of uniqueTexts) {
    let embedding: number[];
    try {
      embedding = await embedText(text);
    } catch (err) {
      console.error("[mcat/import] embedText failed:", err);
      cards_dropped++;
      continue;
    }

    const vecStr = "[" + embedding.join(",") + "]";

    let matchRows: { keyword_id: string; similarity: number }[] = [];
    try {
      const { data, error } = await supabase.rpc("match_mcat_keywords", {
        query_embedding: vecStr,
        match_count: MATCH_COUNT,
      });
      if (error) throw new Error(error.message);
      if (Array.isArray(data)) {
        matchRows = data as typeof matchRows;
      }
    } catch (err) {
      console.error("[mcat/import] match_mcat_keywords RPC failed:", err);
      cards_dropped++;
      continue;
    }

    // Keep only matches above threshold.
    const aboveThreshold = matchRows.filter(
      (m) => m.similarity >= MATCH_THRESHOLD
    );

    if (aboveThreshold.length === 0) {
      cards_dropped++;
      continue;
    }

    cards_matched++;
    for (const match of aboveThreshold) {
      const score = Math.min(1, match.similarity * retention);
      const existing = kwScores.get(match.keyword_id);
      if (existing) {
        existing.push(score);
      } else {
        kwScores.set(match.keyword_id, [score]);
      }
    }
  }

  // ── Aggregate per-keyword confidence (mean of similarity × retention) ────────
  const confidenceByKeyword: Record<string, number> = {};
  for (const [kwId, scores] of kwScores.entries()) {
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    confidenceByKeyword[kwId] = Math.min(1, Math.max(0, mean));
  }

  // ── Seed keyword abilities ────────────────────────────────────────────────────
  const keywords_seeded = await seedKeywordProgress(
    supabase,
    session_id,
    section as McatSection,
    confidenceByKeyword
  );

  // ── Audit row ─────────────────────────────────────────────────────────────────
  const { error: auditErr } = await supabase
    .from("mcat_progress_imports")
    .insert({
      session_id,
      section,
      source: "anki",
      cards_parsed,
      cards_matched,
      cards_dropped,
      keywords_seeded,
    });

  if (auditErr) {
    console.error("[mcat/import] audit insert failed:", auditErr.message);
  }

  return NextResponse.json({
    cards_parsed,
    cards_matched,
    cards_dropped,
    keywords_seeded,
  });
}
