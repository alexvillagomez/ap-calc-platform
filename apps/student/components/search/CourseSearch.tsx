"use client";

/**
 * CourseSearch — free-text topic search for a math course or the MCAT.
 *
 * The student types a query; we POST it to the matching search route, which
 * embeds the query and cosine-matches it against keyword embeddings. Results
 * are rendered as cards with direct links into Practice, Quiz, Lesson (and,
 * for MCAT, Flashcards) scoped to the matched topic.
 */
import { useState, useCallback, type FormEvent } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { trackEvent } from "@/lib/metrics";

type SearchResult = {
  keyword_id: string;
  label: string;
  category_id: string | null;
  score: number;
};

type Props = {
  system: "math" | "mcat";
  /** Required for math (precalc | calc_ab); ignored for mcat. */
  course?: string;
};

type ActionLink = { label: string; href: string };

function buildLinks(
  system: "math" | "mcat",
  course: string | undefined,
  r: SearchResult
): ActionLink[] {
  const label = encodeURIComponent(r.label);
  const kw = encodeURIComponent(r.keyword_id);

  if (system === "math") {
    const c = course ?? "precalc";
    return [
      { label: "Practice", href: `/math/${c}/practice?keyword=${kw}` },
      { label: "Quiz", href: `/math/${c}/quiz?keyword=${kw}` },
      { label: "Lesson", href: `/math/lesson/${kw}` },
    ];
  }

  // mcat — scoped under the matched category, with keyword + label params.
  const cat = encodeURIComponent(r.category_id ?? "");
  if (!r.category_id) {
    // No category linkage — fall back to lesson only.
    return [{ label: "Lesson", href: `/mcat/lesson/${kw}` }];
  }
  const scope = `?keyword=${kw}&label=${label}`;
  return [
    { label: "Practice", href: `/mcat/${cat}/practice${scope}` },
    { label: "Quiz", href: `/mcat/${cat}/quiz${scope}` },
    { label: "Flashcards", href: `/mcat/${cat}/flashcards${scope}` },
    { label: "Lesson", href: `/mcat/lesson/${kw}` },
  ];
}

export default function CourseSearch({ system, course }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q || loading) return;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/${system}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            system === "math" ? { query: q, course } : { query: q }
          ),
        });
        const data = (await res.json()) as {
          results?: SearchResult[];
          error?: string;
        };
        const list = data.results ?? [];
        setResults(list);
        if (data.error && list.length === 0) setError(data.error);

        trackEvent({
          event_type: "search",
          system: system === "math" ? "math" : "mcat",
          course: system === "math" ? course : undefined,
          metadata: { query: q, count: list.length },
        });
      } catch {
        setResults([]);
        setError("Search is temporarily unavailable");
      } finally {
        setLoading(false);
      }
    },
    [query, loading, system, course]
  );

  return (
    <div className="space-y-4">
      <form onSubmit={runSearch} className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            system === "math"
              ? "Search topics — e.g. “chain rule” or “inverse functions”"
              : "Search topics — e.g. “amino acid charge” or “Doppler effect”"
          }
          aria-label="Search topics"
          className="flex-1 px-3 py-2 text-sm rounded-xl border border-neutral-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {loading && (
        <p className="text-sm text-neutral-500">Finding the best topics…</p>
      )}

      {!loading && results !== null && results.length === 0 && (
        <p className="text-sm text-neutral-500">
          {error ?? "No matching topics found. Try different wording."}
        </p>
      )}

      {!loading && results && results.length > 0 && (
        <ul className="space-y-2">
          {results.map((r) => {
            const links = buildLinks(system, course, r);
            const pct = Math.round(Math.max(0, Math.min(1, r.score)) * 100);
            return (
              <li key={r.keyword_id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 truncate">
                      {r.label}
                    </p>
                    <p className="text-xs text-neutral-400">{pct}% match</p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {links.map((link) => (
                      <Link
                        key={link.label}
                        href={link.href}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-200 text-neutral-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
