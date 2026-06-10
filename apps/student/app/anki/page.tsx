"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import JSZip from "jszip";
import initSqlJs from "sql.js";

interface Deck {
  id: string;
  name: string;
  filename: string;
  card_count: number;
  enriched_count: number;
  imported_at: string;
}

type UploadPhase = "idle" | "parsing" | "uploading" | "done" | "error";

interface CardRow {
  anki_note_id: number;
  note_type: string;
  front_html: string;
  back_html: string;
  css: string;
  plain_text: string;
  tags: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function renderTemplate(
  template: string,
  fields: Record<string, string>,
  frontHtml?: string
): string {
  let r = template;
  if (frontHtml !== undefined) r = r.replace(/\{\{FrontSide\}\}/g, frontHtml);
  r = r.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, f, c) => (fields[f.trim()] ? c : ""));
  r = r.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, f, c) => (fields[f.trim()] ? "" : c));
  r = r.replace(/\{\{([^#^/][^}]*)\}\}/g, (m, t) => {
    const n = t.trim();
    if (["Tags", "Type", "Deck", "Subdeck", "CardFlag", "Card"].includes(n)) return "";
    if (n.startsWith("cloze:")) return fields[n.slice(6).trim()] ?? m;
    return fields[n] ?? m;
  });
  return r;
}

function renderCloze(text: string, idx: number) {
  const front = text
    .replace(new RegExp(`\\{\\{c${idx}::([^}:]+)(?:::[^}]+)?\\}\\}`, "g"), '<span class="cloze">[...]</span>')
    .replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, "$1");
  const back = text
    .replace(new RegExp(`\\{\\{c${idx}::([^}:]+)(?:::[^}]+)?\\}\\}`, "g"), '<span class="cloze">$1</span>')
    .replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, "$1");
  return { front, back };
}

function getClozeIndices(text: string): number[] {
  const m = text.match(/\{\{c(\d+)::/g) ?? [];
  return [...new Set(m.map((s) => parseInt(s.match(/\d+/)![0])))].sort((a, b) => a - b);
}

function rewriteMediaSrcs(html: string, srcRewrite: Record<string, string>): string {
  return html.replace(/(<img[^>]+src=")([^"]+)(")/g, (match, pre, src, post) => {
    const url = srcRewrite[src];
    return url ? `${pre}${url}${post}` : match;
  });
}

interface AnkiModel {
  id: string;
  name: string;
  type: number;
  flds: Array<{ name: string; ord: number }>;
  tmpls: Array<{ name: string; qfmt: string; afmt: string; ord: number }>;
  css: string;
}


function sanitizeStoragePath(filename: string): string {
  return filename.replace(/[^\w.\-]/g, "_");
}

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
    mp3: "audio/mpeg", ogg: "audio/ogg", mp4: "video/mp4",
  };
  return map[ext] ?? "application/octet-stream";
}

// Upload all referenced media files via presigned URLs, return src→publicUrl map
async function uploadMedia(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zip: any,
  filenameToNumber: Record<string, string>,
  referencedFiles: Set<string>,
  deckUuid: string,
  supabaseUrl: string,
  onProgress: (done: number, total: number) => void
): Promise<Record<string, string>> {
  const files = [...referencedFiles].filter((f) => filenameToNumber[f]);
  const total = files.length;
  const srcRewrite: Record<string, string> = {};
  let done = 0;

  if (total === 0) return srcRewrite;

  // Get presigned upload URLs for all files in one server call
  const paths = files.map((f) => `${deckUuid}/${sanitizeStoragePath(f)}`);
  const presignRes = await fetch("/api/anki/presign-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!presignRes.ok) {
    console.error("[anki-media] failed to get presigned URLs", await presignRes.text().catch(() => ""));
    return srcRewrite;
  }
  const { urls } = (await presignRes.json()) as { urls: { path: string; signedUrl: string | null }[] };
  const signedUrlMap: Record<string, string> = Object.fromEntries(
    urls.filter((u) => u.signedUrl).map((u) => [u.path, u.signedUrl as string])
  );

  const base = supabaseUrl.replace(/\/$/, "");

  const CONCURRENCY = 10;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    await Promise.all(
      files.slice(i, i + CONCURRENCY).map(async (filename) => {
        const encodedPath = `${deckUuid}/${sanitizeStoragePath(filename)}`;
        const signedUrl = signedUrlMap[encodedPath];
        if (!signedUrl) { done++; onProgress(done, total); return; }

        const numberedName = filenameToNumber[filename];
        const zipEntry = zip.file(numberedName);
        if (!zipEntry) { done++; onProgress(done, total); return; }

        const bytes = await zipEntry.async("arraybuffer");
        const mime = guessMime(filename);
        const res = await fetch(signedUrl, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: new Blob([bytes], { type: mime }),
        });

        if (res.ok) {
          srcRewrite[filename] = `${base}/storage/v1/object/public/anki-media/${encodedPath}`;
        } else {
          const body = await res.text().catch(() => "");
          console.error(`[anki-media] upload failed ${res.status} for ${encodedPath}:`, body);
        }

        done++;
        onProgress(done, total);
      })
    );
  }

  return srcRewrite;
}

async function parseApkg(
  file: File,
  deckUuid: string,
  supabaseUrl: string,
  onProgress: (label: string, done: number, total: number) => void
): Promise<{ deckName: string; cards: CardRow[] }> {
  const SQL = await initSqlJs({
    locateFile: (f: string) => `/${f}`,
  });

  onProgress("Parsing deck…", 0, 0);

  const zip = await JSZip.loadAsync(file);

  // Read media index: { "0": "paste-abc.jpg", ... } → invert to { "paste-abc.jpg": "0" }
  const mediaIndexFile = zip.file("media");
  const mediaMap: Record<string, string> = mediaIndexFile
    ? JSON.parse(await mediaIndexFile.async("text"))
    : {};
  const filenameToNumber: Record<string, string> = Object.fromEntries(
    Object.entries(mediaMap).map(([num, name]) => [name as string, num])
  );

  // Parse SQLite
  const dbFile = zip.file("collection.anki21") ?? zip.file("collection.anki2");
  if (!dbFile) throw new Error("No collection database found in .apkg");

  const dbBytes = await dbFile.async("arraybuffer");
  const db = new SQL.Database(new Uint8Array(dbBytes));

  const colResult = db.exec("SELECT decks, models FROM col LIMIT 1");
  if (!colResult.length || !colResult[0].values.length) throw new Error("Could not read collection config");

  const [decksJson, modelsJson] = colResult[0].values[0] as [string, string];
  const decksObj = JSON.parse(decksJson) as Record<string, { name: string }>;
  const modelsObj = JSON.parse(modelsJson) as Record<string, AnkiModel>;

  const deckName =
    Object.values(decksObj).find((d) => d.name !== "Default")?.name ??
    file.name.replace(".apkg", "");

  const notesResult = db.exec("SELECT id, mid, flds, tags FROM notes");
  const noteRows = notesResult[0]?.values ?? [];
  const cards: CardRow[] = [];

  for (const row of noteRows) {
    const [noteId, mid, fldsRaw, tagsRaw] = row as [number, number, string, string];
    const model = modelsObj[String(mid)];
    if (!model) continue;

    const fieldValues = (fldsRaw as string).split("\x1f");
    const fields: Record<string, string> = {};
    model.flds.forEach((f, i) => { fields[f.name] = fieldValues[i] ?? ""; });

    const tags = (tagsRaw as string).trim().split(/\s+/).filter(Boolean);
    const css = model.css ?? "";

    if (model.type === 1) {
      const clozeText = fields[model.flds[0]?.name ?? "Text"] ?? "";
      const indices = getClozeIndices(clozeText);
      for (const idx of (indices.length > 0 ? indices : [1])) {
        const { front, back } = renderCloze(clozeText, idx);
        cards.push({
          anki_note_id: noteId,
          note_type: model.name,
          front_html: `<div class="card">${front}</div>`,
          back_html: `<div class="card">${back}</div>`,
          css,
          plain_text: stripHtml(clozeText.replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, "$1")),
          tags,
        });
      }
    } else {
      const tmpl = model.tmpls[0];
      if (!tmpl) continue;
      const frontHtml = renderTemplate(tmpl.qfmt, fields);
      const backHtml = renderTemplate(tmpl.afmt, fields, frontHtml);
      cards.push({
        anki_note_id: noteId,
        note_type: model.name,
        front_html: frontHtml,
        back_html: backHtml,
        css,
        plain_text: stripHtml(Object.values(fields).join(" ")),
        tags,
      });
    }
  }

  db.close();

  // Collect all image filenames referenced in card HTML
  const referencedFiles = new Set<string>();
  const imgRegex = /<img[^>]+src="([^"]+)"/g;
  for (const card of cards) {
    for (const html of [card.front_html, card.back_html]) {
      for (const m of html.matchAll(imgRegex)) referencedFiles.add(m[1]);
    }
  }

  // Upload media if any images exist in the deck
  if (referencedFiles.size > 0 && Object.keys(filenameToNumber).length > 0) {
    const srcRewrite = await uploadMedia(
      zip,
      filenameToNumber,
      referencedFiles,
      deckUuid,
      supabaseUrl,
      (done, total) => onProgress("Uploading images…", done, total)
    );

    // Rewrite img src in all cards
    for (const card of cards) {
      card.front_html = rewriteMediaSrcs(card.front_html, srcRewrite);
      card.back_html = rewriteMediaSrcs(card.back_html, srcRewrite);
    }
  }

  return { deckName, cards };
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function AnkiPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const sessionId =
    typeof window !== "undefined"
      ? localStorage.getItem("ap_calc_student_session_id") ?? ""
      : "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const refreshDecks = async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/anki/decks?session_id=${sessionId}`);
    const d = await res.json();
    setDecks(d.decks ?? []);
  };

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    refreshDecks().finally(() => setLoading(false));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (file: File) => {
    if (!sessionId) { setErrorMsg("Please log in first."); return; }
    if (!file.name.endsWith(".apkg")) { setErrorMsg("Please select a .apkg file."); return; }

    setErrorMsg("");
    const deckUuid = crypto.randomUUID();

    // Step 1: Parse deck + upload media in browser
    setPhase("parsing");
    setProgress({ done: 0, total: 0, label: "Parsing deck…" });

    let deckName: string;
    let cards: CardRow[];
    try {
      ({ deckName, cards } = await parseApkg(
        file,
        deckUuid,
        supabaseUrl,
        (label, done, total) => setProgress({ label, done, total })
      ));
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message ?? "Failed to parse .apkg");
      return;
    }

    if (cards.length === 0) {
      setPhase("error");
      setErrorMsg("No cards found in deck.");
      return;
    }

    // Step 2: Create deck record (with client-generated UUID so storage paths match)
    setPhase("uploading");
    setProgress({ done: 0, total: cards.length, label: "Creating deck…" });

    const importRes = await fetch("/api/anki/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        name: deckName,
        filename: file.name,
        card_count: cards.length,
        deck_id: deckUuid,
      }),
    });
    const importData = await importRes.json();
    if (!importRes.ok) {
      setPhase("error");
      setErrorMsg(importData.error ?? "Failed to create deck.");
      return;
    }

    // Step 3: Upload cards in batches of 50
    const BATCH = 50;
    for (let i = 0; i < cards.length; i += BATCH) {
      setProgress({ done: i, total: cards.length, label: "Uploading cards…" });
      const batchRes = await fetch("/api/anki/batch-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck_id: deckUuid, cards: cards.slice(i, i + BATCH) }),
      });
      if (!batchRes.ok) {
        const err = await batchRes.json().catch(() => ({}));
        setPhase("error");
        setErrorMsg(err.error ?? "Failed to upload cards.");
        return;
      }
    }

    await refreshDecks();
    setPhase("done");
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const isImporting = phase === "parsing" || phase === "uploading";
  const uploadPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const showProgressBar = (phase === "uploading" || (phase === "parsing" && progress.total > 0)) && progress.total > 0;

  const statusLabel = () => {
    if (phase === "parsing") return progress.label || "Parsing deck…";
    if (phase === "uploading") return `${progress.label} (${uploadPct}%)`;
    if (phase === "done") return "Import complete!";
    if (phase === "error") return errorMsg;
    return "Drop an .apkg file here or click to upload";
  };

  if (loading) return <div className="p-8 text-gray-500 text-sm">Loading…</div>;

  if (!sessionId) {
    return (
      <div className="p-8 text-center text-gray-600">
        <p className="mb-3">Please log in to use Anki import.</p>
        <Link href="/login" className="text-blue-600 underline text-sm">Log in →</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Anki Decks</h1>
        <Link href="/precalc" className="text-xs text-gray-500 hover:text-gray-700">← Back</Link>
      </div>

      {/* Upload zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center mb-6 transition-colors ${
          isImporting
            ? "border-blue-300 bg-blue-50 cursor-default"
            : phase === "error"
            ? "border-red-300 bg-red-50 cursor-pointer"
            : "border-gray-300 hover:border-gray-400 cursor-pointer"
        }`}
        onClick={() => { if (!isImporting) fileRef.current?.click(); }}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <input ref={fileRef} type="file" accept=".apkg" className="hidden" onChange={onFileChange} />

        <p className={`text-sm ${phase === "error" ? "text-red-600" : phase === "done" ? "text-green-600" : "text-gray-500"}`}>
          {statusLabel()}
        </p>

        {showProgressBar && (
          <div className="mt-3 h-1.5 bg-blue-100 rounded-full overflow-hidden mx-auto max-w-xs">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-200"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        )}

        {phase === "parsing" && progress.total === 0 ? (
          <div className="mt-3 flex justify-center">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : null}

        {!isImporting && phase !== "done" && (
          <p className="text-xs text-gray-400 mt-1">Works with any size deck — images included</p>
        )}
      </div>

      {/* Deck list */}
      {decks.length === 0 ? (
        <p className="text-center text-gray-400 text-sm">No decks imported yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {decks.map((deck) => (
            <div key={deck.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{deck.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{deck.card_count} cards</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link
                    href={`/anki/${deck.id}/study`}
                    className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700"
                  >
                    Study
                  </Link>
                  <Link
                    href={`/anki/${deck.id}/progress`}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50"
                  >
                    Progress
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
