/**
 * ingest-openstax.ts
 *
 * RESUMABLE, IDEMPOTENT OpenStax textbook ingestion pipeline.
 * Downloads CC BY-licensed OpenStax textbook content from GitHub (CNXML source),
 * chunks it into ~500-1000-token semantic units preserving book/chapter/section
 * provenance + canonical URL, embeds each chunk (text-embedding-3-small), and
 * upserts into the `openstax_chunks` table. Designed for MCAT keyword "must-state
 * facts" enrichment grounding.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * LICENSE GATE — VERIFIED 2026-06-30
 * ────────────────────────────────────────────────────────────────────────────────
 * OpenStax textbooks use CC BY-NC-SA 4.0 for almost all titles.
 * The NonCommercial clause prohibits ingestion into a paid/commercial product
 * WITHOUT first obtaining a reuse exception from Rice University.
 * Source: https://help.openstax.org/s/article/Commercial-use-under-the-Creative-Commons-License
 * License text confirmed in each repo's LICENSE file on GitHub (openstax org).
 *
 * Per-title license findings (verified from GitHub CNXML source + book preface pages):
 *   Biology 2e                   → CC BY-NC-SA 4.0  ❌ NOT ingestible
 *   Chemistry 2e                 → CC BY-NC-SA 4.0  ❌ NOT ingestible
 *   University Physics           → CC BY-NC-SA 4.0  ❌ NOT ingestible
 *   College Physics 2e           → CC BY-NC-SA 4.0  ❌ NOT ingestible
 *   Psychology 2e                → CC BY-NC-SA 4.0  ❌ NOT ingestible
 *   Introduction to Sociology 3e → CC BY-NC-SA 4.0  ❌ NOT ingestible
 *   Microbiology                 → CC BY-NC-SA 4.0  ❌ NOT ingestible
 *   Anatomy & Physiology 2e      → CC BY-NC-SA 4.0  ❌ NOT ingestible
 *   Biology for AP® Courses      → CC BY-NC-SA 4.0  ❌ NOT ingestible (prior doc was wrong)
 *   Physics (HS, osbooks-physics) → CC BY 4.0        ✅ Ingestible (not MCAT-relevant)
 *
 * NOTE: The existing docs/mcat-depth-reference-research.md incorrectly listed
 * "Biology for AP® Courses" as CC BY. The collection XML on GitHub confirms
 * it is also CC BY-NC-SA 4.0. None of the 7 MCAT-relevant titles can be
 * commercially ingested without a reuse agreement.
 *
 * ACTION: The BOOK_REGISTRY below marks MCAT titles as BLOCKED with license reason.
 * If Rice University grants a commercial reuse exception (via their reuse form),
 * change the license field to "CC BY 4.0" and the blocked flag to false.
 * Reuse form: https://openstax.org/contact
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * ACQUISITION METHOD
 * ────────────────────────────────────────────────────────────────────────────────
 * Source: OpenStax GitHub organization (https://github.com/openstax) — each book
 * has a repository (e.g., osbooks-biology-bundle) containing:
 *   - collections/<slug>.collection.xml — chapter/section structure (CNXML)
 *   - modules/<module-id>/index.cnxml  — per-section prose content (CNXML XML)
 *
 * Why GitHub/CNXML over web-scraping:
 *   1. Deterministic, structured — no JavaScript rendering, no rate-limit risk.
 *   2. Preserves chapter/section hierarchy directly in XML tags.
 *   3. Source of truth — same files that become the rendered web pages.
 *   4. Polite by design — GitHub API has a token rate limit we respect via delays.
 *
 * CNXML text extraction strategy:
 *   - Parse <para>, <title>, <term>, <list>/<item> elements.
 *   - Strip figures, equations (MathML), image references, footnotes.
 *   - Normalize whitespace.
 *   - Chunk per SEMANTIC UNIT: each <section> within a module becomes one
 *     chunk (if ≤1000 tokens) or is split at paragraph boundaries to stay
 *     within 500-1000 tokens.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ────────────────────────────────────────────────────────────────────────────────
 *   tsx scripts/ingest-openstax.ts --book biology-2e --dry-run
 *   tsx scripts/ingest-openstax.ts --book biology-2e --chapter 1 --resume
 *   tsx scripts/ingest-openstax.ts --book physics      # only CC BY 4.0 title
 *
 * FLAGS:
 *   --book <slug>        Book slug from BOOK_REGISTRY (required)
 *   --chapter <n>        Only ingest chapter n (1-indexed; for proof runs)
 *   --resume             Skip modules that already have chunks in openstax_chunks
 *   --dry-run            Count chunks + estimate cost; no OpenAI calls or DB writes
 *   --force              Re-embed and overwrite existing chunks (use sparingly)
 *
 * Env: loads root .env.local, then overrides OPENAI_API_KEY from apps/student/.env.local
 * (root key is stale/401 — see project memory project_openai_key_split.md).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { createServiceClient } from "./lib/serviceClient";

// ─── Env loading ─────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
}

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const bookArg   = args[args.indexOf("--book")   + 1] ?? null;
const chapterArg = args.includes("--chapter")
  ? parseInt(args[args.indexOf("--chapter") + 1] ?? "0", 10)
  : null;
const isDryRun  = args.includes("--dry-run");
const isResume  = args.includes("--resume");
const isForce   = args.includes("--force");

// ─── Book Registry ────────────────────────────────────────────────────────────
// license: the VERIFIED license (from GitHub CNXML collection XML + preface pages)
// blocked: true = CC BY-NC-SA — DO NOT ingest without Rice University reuse approval
// githubRepo: the openstax org GitHub repository name
// collectionFile: the collection XML file within collections/ directory
// pageBase: canonical URL prefix for pages (used for citation)
interface BookDef {
  slug: string;
  title: string;
  license: string;
  licenseUrl: string;
  blocked: boolean;
  blockReason?: string;
  githubRepo: string;
  collectionFile: string;
  pageBase: string;
}

const BOOK_REGISTRY: Record<string, BookDef> = {
  "biology-2e": {
    slug: "biology-2e",
    title: "Biology 2e",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    blocked: true,
    blockReason: "CC BY-NC-SA 4.0 prohibits commercial use. Request reuse exception at https://openstax.org/contact",
    githubRepo: "osbooks-biology-bundle",
    collectionFile: "biology-2e.collection.xml",
    pageBase: "https://openstax.org/books/biology-2e/pages/",
  },
  "chemistry-2e": {
    slug: "chemistry-2e",
    title: "Chemistry 2e",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    blocked: true,
    blockReason: "CC BY-NC-SA 4.0 prohibits commercial use. Request reuse exception at https://openstax.org/contact",
    githubRepo: "osbooks-chemistry-bundle",
    collectionFile: "chemistry-2e.collection.xml",
    pageBase: "https://openstax.org/books/chemistry-2e/pages/",
  },
  "university-physics-volume-1": {
    slug: "university-physics-volume-1",
    title: "University Physics Volume 1",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    blocked: true,
    blockReason: "CC BY-NC-SA 4.0 prohibits commercial use. Request reuse exception at https://openstax.org/contact",
    githubRepo: "osbooks-university-physics-bundle",
    collectionFile: "university-physics-volume-1.collection.xml",
    pageBase: "https://openstax.org/books/university-physics-volume-1/pages/",
  },
  "psychology-2e": {
    slug: "psychology-2e",
    title: "Psychology 2e",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    blocked: true,
    blockReason: "CC BY-NC-SA 4.0 prohibits commercial use. Request reuse exception at https://openstax.org/contact",
    githubRepo: "osbooks-psychology",
    collectionFile: "psychology-2e.collection.xml",
    pageBase: "https://openstax.org/books/psychology-2e/pages/",
  },
  "introduction-sociology-3e": {
    slug: "introduction-sociology-3e",
    title: "Introduction to Sociology 3e",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    blocked: true,
    blockReason: "CC BY-NC-SA 4.0 prohibits commercial use. Request reuse exception at https://openstax.org/contact",
    githubRepo: "osbooks-introduction-sociology",
    collectionFile: "introduction-sociology-3e.collection.xml",
    pageBase: "https://openstax.org/books/introduction-sociology-3e/pages/",
  },
  "microbiology": {
    slug: "microbiology",
    title: "Microbiology",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    blocked: true,
    blockReason: "CC BY-NC-SA 4.0 prohibits commercial use. Request reuse exception at https://openstax.org/contact",
    githubRepo: "osbooks-microbiology",
    collectionFile: "microbiology.collection.xml",
    pageBase: "https://openstax.org/books/microbiology/pages/",
  },
  "anatomy-physiology-2e": {
    slug: "anatomy-physiology-2e",
    title: "Anatomy and Physiology 2e",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    blocked: true,
    blockReason: "CC BY-NC-SA 4.0 prohibits commercial use. Request reuse exception at https://openstax.org/contact",
    githubRepo: "osbooks-anatomy-physiology",
    collectionFile: "anatomy-physiology-2e.collection.xml",
    pageBase: "https://openstax.org/books/anatomy-and-physiology-2e/pages/",
  },
  "biology-ap-courses": {
    slug: "biology-ap-courses",
    title: "Biology for AP® Courses",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    blocked: true,
    blockReason: "CC BY-NC-SA 4.0 prohibits commercial use (prior doc was wrong — confirmed CC BY-NC-SA in collection XML). Request reuse exception at https://openstax.org/contact",
    githubRepo: "osbooks-biology-bundle",
    collectionFile: "biology-ap-courses.collection.xml",
    pageBase: "https://openstax.org/books/biology-ap-courses/pages/",
  },
  // ── CC BY 4.0 titles (safe to ingest) ──────────────────────────────────────
  "physics": {
    slug: "physics",
    title: "Physics (OpenStax HS)",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    blocked: false,
    githubRepo: "osbooks-physics",
    collectionFile: "physics.collection.xml",
    pageBase: "https://openstax.org/books/physics/pages/",
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface ParsedModule {
  moduleId: string;
  title: string;
  sections: ParsedSection[];
}

interface ParsedSection {
  title: string;
  paragraphs: string[];
}

interface Chunk {
  book: string;
  chapter: string;
  section: string;
  url: string;
  content: string;
  tokenCount: number;
  contentHash: string;
}

// ─── GitHub fetch helpers ─────────────────────────────────────────────────────

const GH_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GH_HEADERS: Record<string, string> = {
  "Accept": "application/vnd.github.v3+json",
  "User-Agent": "lodera-openstax-ingest/1.0",
  ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
};

async function ghGet(url: string): Promise<Response> {
  const res = await fetch(url, { headers: GH_HEADERS });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const msg = reset
      ? `GitHub rate limit hit. Resets at ${new Date(parseInt(reset, 10) * 1000).toISOString()}.`
      : "GitHub rate limit hit.";
    console.error(`\n[RATE LIMIT] ${msg}`);
    console.error("  Set GITHUB_TOKEN env var for higher limits (5000/hr vs 60/hr unauthenticated).");
    process.exit(1); // Stop cleanly — do not retry in a loop
  }
  return res;
}

async function ghGetContent(repo: string, filePath: string): Promise<string> {
  const url = `https://api.github.com/repos/openstax/${repo}/contents/${filePath}`;
  const res = await ghGet(url);
  if (!res.ok) {
    throw new Error(`GitHub 404: openstax/${repo}/${filePath}`);
  }
  const json = await res.json() as { content: string; encoding: string };
  if (json.encoding === "base64") {
    return Buffer.from(json.content, "base64").toString("utf-8");
  }
  return json.content;
}

/** Polite delay between GitHub API calls (avoid hammering) */
async function politeDelay(ms = 200): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ─── Collection XML parsing ──────────────────────────────────────────────────

interface CollectionChapter {
  title: string;
  modules: string[]; // module IDs
}

/** Parse a collection XML file into ordered chapters + module IDs. */
function parseCollectionXml(xml: string): CollectionChapter[] {
  const chapters: CollectionChapter[] = [];

  // Extract top-level subcollections (chapters)
  // Pattern: <col:subcollection> ... <md:title>...</md:title> ... modules ... </col:subcollection>
  const subColRegex = /<col:subcollection>([\s\S]*?)<\/col:subcollection>/g;
  let subColMatch: RegExpExecArray | null;

  while ((subColMatch = subColRegex.exec(xml)) !== null) {
    const subColContent = subColMatch[1]!;
    const titleMatch = subColContent.match(/<md:title>(.*?)<\/md:title>/);
    const chapterTitle = titleMatch ? cleanText(titleMatch[1]!) : "Unknown Chapter";

    // Find all module IDs within this subcollection (including nested subcollections)
    const moduleIds: string[] = [];
    const moduleRegex = /<col:module\s+document="([^"]+)"/g;
    let modMatch: RegExpExecArray | null;
    while ((modMatch = moduleRegex.exec(subColContent)) !== null) {
      moduleIds.push(modMatch[1]!);
    }

    if (moduleIds.length > 0) {
      chapters.push({ title: chapterTitle, modules: moduleIds });
    }
  }

  return chapters;
}

// ─── CNXML text extraction ───────────────────────────────────────────────────

/** Remove XML tags and normalize whitespace. */
function stripTags(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Extract sections from a CNXML module file. */
function parseCnxml(cnxml: string): ParsedModule {
  // Get module title
  const titleMatch = cnxml.match(/<md:title>(.*?)<\/md:title>/);
  const moduleTitle = titleMatch ? cleanText(titleMatch[1]!) : "Untitled";

  // Get content block
  const contentMatch = cnxml.match(/<content>([\s\S]*)<\/content>/);
  const content = contentMatch ? contentMatch[1]! : cnxml;

  // Remove MathML blocks entirely (too noisy for text embedding)
  const noMath = content
    .replace(/<math[\s\S]*?<\/math>/g, " [EQUATION] ")
    .replace(/<mml:math[\s\S]*?<\/mml:math>/g, " [EQUATION] ");

  // Remove figure/media blocks (image references are not useful text)
  const noFigs = noMath
    .replace(/<figure[\s\S]*?<\/figure>/g, " ")
    .replace(/<media[\s\S]*?<\/media>/g, " ");

  // Remove note/exercise blocks (supplementary, not core prose)
  const noNotes = noFigs
    .replace(/<note[\s\S]*?<\/note>/g, " ")
    .replace(/<exercise[\s\S]*?<\/exercise>/g, " ");

  const sections: ParsedSection[] = [];

  // Extract named sections
  const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/g;
  let sectionMatch: RegExpExecArray | null;
  const sectionPositions: Array<{ start: number; end: number }> = [];

  while ((sectionMatch = sectionRegex.exec(noNotes)) !== null) {
    const sectionContent = sectionMatch[1]!;
    const sTitle = sectionContent.match(/<title>(.*?)<\/title>/);
    const sectionTitle = sTitle ? cleanText(stripTags(sTitle[1]!)) : moduleTitle;

    // Extract paragraphs in this section
    const paraRegex = /<para[^>]*>([\s\S]*?)<\/para>/g;
    const paragraphs: string[] = [];
    let paraMatch: RegExpExecArray | null;
    while ((paraMatch = paraRegex.exec(sectionContent)) !== null) {
      const text = cleanText(stripTags(paraMatch[1]!));
      if (text.length > 40) { // skip tiny fragments
        paragraphs.push(text);
      }
    }

    // Also extract list items
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let itemMatch: RegExpExecArray | null;
    const listItems: string[] = [];
    while ((itemMatch = itemRegex.exec(sectionContent)) !== null) {
      const text = cleanText(stripTags(itemMatch[1]!));
      if (text.length > 20) listItems.push("• " + text);
    }
    if (listItems.length > 0) {
      paragraphs.push(listItems.join("\n"));
    }

    if (paragraphs.length > 0) {
      sections.push({ title: sectionTitle, paragraphs });
    }
    sectionPositions.push({ start: sectionMatch.index!, end: sectionMatch.index! + sectionMatch[0].length });
  }

  // Capture top-level paragraphs (before any <section>) as intro section
  const firstSectionStart = sectionPositions.length > 0 ? sectionPositions[0]!.start : noNotes.length;
  const introContent = noNotes.slice(0, firstSectionStart);
  const introParagraphs: string[] = [];
  const introParaRegex = /<para[^>]*>([\s\S]*?)<\/para>/g;
  let introParaMatch: RegExpExecArray | null;
  while ((introParaMatch = introParaRegex.exec(introContent)) !== null) {
    const text = cleanText(stripTags(introParaMatch[1]!));
    if (text.length > 40) introParagraphs.push(text);
  }
  if (introParagraphs.length > 0) {
    sections.unshift({ title: moduleTitle, paragraphs: introParagraphs });
  }

  // If no sections were found at all, parse the whole content as one section
  if (sections.length === 0) {
    const allParas: string[] = [];
    const allParaRegex = /<para[^>]*>([\s\S]*?)<\/para>/g;
    let allParaMatch: RegExpExecArray | null;
    while ((allParaMatch = allParaRegex.exec(noNotes)) !== null) {
      const text = cleanText(stripTags(allParaMatch[1]!));
      if (text.length > 40) allParas.push(text);
    }
    if (allParas.length > 0) {
      sections.push({ title: moduleTitle, paragraphs: allParas });
    }
  }

  return { moduleId: "", title: moduleTitle, sections };
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

const TARGET_TOKENS = 700;   // target chunk size in tokens (chars/4)
const MAX_TOKENS    = 1100;  // hard max before forced split

/**
 * Splits a section into chunks of ~TARGET_TOKENS by joining paragraphs greedily.
 * Returns an array of content strings.
 */
function chunkSection(sectionTitle: string, paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = Math.ceil(para.length / 4);
    if (currentTokens + paraTokens > MAX_TOKENS && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(para);
    currentTokens += paraTokens;
    if (currentTokens >= TARGET_TOKENS) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
  }
  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  // Prefix each chunk with the section title for context
  return chunks.map((c) => `${sectionTitle}\n\n${c}`);
}

// ─── Chunk assembly ───────────────────────────────────────────────────────────

function buildChunks(
  bookSlug: string,
  chapterTitle: string,
  module: ParsedModule,
  moduleId: string,
  pageBase: string
): Chunk[] {
  const url = `${pageBase}${moduleId}`;
  const chunks: Chunk[] = [];

  for (const section of module.sections) {
    if (section.paragraphs.length === 0) continue;

    const textChunks = chunkSection(section.title, section.paragraphs);
    for (const text of textChunks) {
      const hash = crypto
        .createHash("sha256")
        .update(bookSlug + url + text)
        .digest("hex");

      chunks.push({
        book: bookSlug,
        chapter: chapterTitle,
        section: section.title,
        url,
        content: text,
        tokenCount: Math.ceil(text.length / 4),
        contentHash: hash,
      });
    }
  }
  return chunks;
}

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embedBatch(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Upsert helpers ───────────────────────────────────────────────────────────

async function getExistingHashes(
  supabase: SupabaseClient,
  bookSlug: string
): Promise<Set<string>> {
  const hashes = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("openstax_chunks")
      .select("content_hash")
      .eq("book", bookSlug)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`DB fetch error: ${error.message}`);
    const rows = (data ?? []) as Array<{ content_hash: string }>;
    for (const r of rows) hashes.add(r.content_hash);
    if (rows.length < PAGE) break;
  }
  return hashes;
}

async function upsertChunkBatch(
  supabase: SupabaseClient,
  chunks: Chunk[],
  embeddings: number[][]
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    const emb = embeddings[i]!;

    const { error } = await supabase.from("openstax_chunks").upsert(
      {
        book: c.book,
        chapter: c.chapter,
        section: c.section,
        url: c.url,
        content: c.content,
        token_count: c.tokenCount,
        embedding_vec: emb,
        content_hash: c.contentHash,
      },
      { onConflict: "content_hash", ignoreDuplicates: true }
    );

    if (error) {
      // ignoreDuplicates means conflict = skip (no error thrown); any other error is real
      console.error(`  [ERROR] Upsert failed: ${error.message}`);
      skipped++;
    } else {
      inserted++;
    }
  }
  return { inserted, skipped };
}

// ─── Main ingestion loop ──────────────────────────────────────────────────────

async function main() {
  console.log("=== ingest-openstax ===");

  // ── Validate book arg
  if (!bookArg) {
    console.error("Usage: tsx scripts/ingest-openstax.ts --book <slug> [--chapter N] [--resume] [--dry-run]");
    console.error("\nAvailable slugs:");
    for (const [slug, def] of Object.entries(BOOK_REGISTRY)) {
      const status = def.blocked ? `❌ BLOCKED (${def.license})` : `✅ OK (${def.license})`;
      console.error(`  ${slug.padEnd(40)} ${status}`);
    }
    process.exit(1);
  }

  const book = BOOK_REGISTRY[bookArg];
  if (!book) {
    console.error(`Unknown book slug: "${bookArg}". Run without --book to see available slugs.`);
    process.exit(1);
  }

  // ── License gate — HARD STOP for CC BY-NC-SA
  console.log(`\nBook:    ${book.title}`);
  console.log(`License: ${book.license} — ${book.licenseUrl}`);
  if (book.blocked) {
    console.error(`\n[LICENSE GATE] BLOCKED: ${book.blockReason}`);
    console.error("\nTo proceed with a CC BY-NC-SA title you must:");
    console.error("  1. Obtain a written reuse exception from Rice University (https://openstax.org/contact).");
    console.error("  2. Update BOOK_REGISTRY[slug].blocked = false and license = \"CC BY 4.0\" in this script.");
    console.error("  3. Re-run ingestion.");
    process.exit(1);
  }
  console.log("License gate: PASSED");

  // ── Load collection XML to get chapter structure
  console.log(`\nFetching collection: ${book.collectionFile} from openstax/${book.githubRepo}...`);
  let collectionXml: string;
  try {
    collectionXml = await ghGetContent(book.githubRepo, `collections/${book.collectionFile}`);
  } catch (e) {
    console.error(`[ERROR] Could not fetch collection XML: ${(e as Error).message}`);
    process.exit(1);
  }

  const chapters = parseCollectionXml(collectionXml);
  console.log(`  Parsed ${chapters.length} chapters`);
  if (chapters.length === 0) {
    console.error("[ERROR] No chapters parsed from collection XML. Check the file structure.");
    process.exit(1);
  }

  // ── Chapter filter (for proof runs)
  const targetChapters = chapterArg !== null
    ? chapters.slice(chapterArg - 1, chapterArg)
    : chapters;
  if (chapterArg !== null) {
    const ch = targetChapters[0];
    if (!ch) {
      console.error(`[ERROR] Chapter ${chapterArg} does not exist. Book has ${chapters.length} chapters.`);
      process.exit(1);
    }
    console.log(`  Scoped to chapter ${chapterArg}: "${ch.title}" (${ch.modules.length} modules)`);
  }

  const totalModules = targetChapters.reduce((acc, ch) => acc + ch.modules.length, 0);
  console.log(`  Total modules to process: ${totalModules}`);

  if (isDryRun) console.log("\n[DRY RUN] Will count chunks and estimate cost; no OpenAI calls or DB writes.");

  // ── Supabase + OpenAI clients
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createServiceClient(supabaseUrl, serviceKey);

  let openai!: OpenAI;
  if (!isDryRun) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }
    openai = new OpenAI({ apiKey: openaiKey });
  }

  // ── Load existing hashes for resume
  let existingHashes = new Set<string>();
  if (isResume && !isDryRun) {
    console.log("\nLoading existing chunk hashes for resume...");
    existingHashes = await getExistingHashes(supabase, book.slug);
    console.log(`  ${existingHashes.size} chunks already in DB — will skip these`);
  }

  // ─── Main loop ───────────────────────────────────────────────────────────────
  let totalChunks = 0;
  let totalTokens = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailedModules = 0;
  const EMBED_BATCH = 50; // embeddings per OpenAI request

  for (const [chIdx, chapter] of targetChapters.entries()) {
    console.log(`\n[Chapter ${chIdx + 1}/${targetChapters.length}] "${chapter.title}" — ${chapter.modules.length} modules`);

    const chapterChunks: Chunk[] = [];

    for (const moduleId of chapter.modules) {
      await politeDelay(150); // polite pacing — ~6 requests/sec
      let cnxml: string;
      try {
        cnxml = await ghGetContent(book.githubRepo, `modules/${moduleId}/index.cnxml`);
      } catch (e) {
        console.warn(`  [WARN] Module ${moduleId} not found — skipping: ${(e as Error).message}`);
        totalFailedModules++;
        continue;
      }

      const parsed = parseCnxml(cnxml);
      const chunks = buildChunks(book.slug, chapter.title, parsed, moduleId, book.pageBase);

      if (chunks.length === 0) {
        console.warn(`  [WARN] Module ${moduleId} ("${parsed.title}") produced 0 chunks — sparse content`);
        continue;
      }

      // Filter already-embedded chunks in resume mode
      const newChunks = isResume
        ? chunks.filter((c) => !existingHashes.has(c.contentHash))
        : chunks;

      chapterChunks.push(...newChunks);
      totalTokens += newChunks.reduce((acc, c) => acc + c.tokenCount, 0);

      if (!isDryRun && process.env.VERBOSE) {
        console.log(`  Module ${moduleId} "${parsed.title}": ${chunks.length} chunks (${newChunks.length} new)`);
      }
    }

    totalChunks += chapterChunks.length;
    if (isDryRun) {
      console.log(`  Chapter produces ${chapterChunks.length} chunks (~${Math.round(chapterChunks.reduce((a, c) => a + c.tokenCount, 0)).toLocaleString()} tokens)`);
      continue;
    }

    if (chapterChunks.length === 0) {
      console.log(`  All chunks already in DB — nothing to do for this chapter`);
      continue;
    }

    // ── Embed + upsert in batches
    for (const batch of chunkArray(chapterChunks, EMBED_BATCH)) {
      const texts = batch.map((c) => c.content);
      let embeddings: number[][];
      try {
        embeddings = await embedBatch(openai, texts);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("rate") || msg.includes("limit") || msg.includes("429")) {
          console.error(`\n[RATE LIMIT] OpenAI rate limit hit: ${msg}`);
          console.error("Stop cleanly — re-run with --resume to continue from here.");
          process.exit(1);
        }
        console.error(`  [ERROR] Embedding batch failed: ${msg}`);
        totalSkipped += batch.length;
        continue;
      }

      const { inserted, skipped } = await upsertChunkBatch(supabase, batch, embeddings);
      totalInserted += inserted;
      totalSkipped += skipped;

      // Update existingHashes for in-session dedup
      for (const c of batch) existingHashes.add(c.contentHash);
    }
    console.log(`  Chapter done: ${chapterChunks.length} new chunks upserted`);
  }

  // ─── Summary ──────────────────────────────────────────────────────────────────
  const estimatedCostUSD = (totalTokens / 1_000_000) * 0.02; // $0.02 / 1M tokens
  console.log("\n=== Summary ===");
  console.log(`  Book:               ${book.title}`);
  console.log(`  License:            ${book.license}`);
  console.log(`  Chapters processed: ${targetChapters.length}`);
  console.log(`  Modules failed:     ${totalFailedModules}`);
  if (isDryRun) {
    console.log(`  Chunks (estimated): ${totalChunks}`);
    console.log(`  Tokens (estimated): ~${totalTokens.toLocaleString()}`);
    console.log(`  Cost (estimated):   ~$${estimatedCostUSD.toFixed(4)} USD (text-embedding-3-small @ $0.02/1M)`);
    console.log("\n[DRY RUN] Done. No writes performed.");
  } else {
    console.log(`  Chunks inserted:    ${totalInserted}`);
    console.log(`  Chunks skipped:     ${totalSkipped}`);
    console.log(`  Tokens embedded:    ~${totalTokens.toLocaleString()}`);
    console.log(`  Embed cost:         ~$${estimatedCostUSD.toFixed(4)} USD`);
  }
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
