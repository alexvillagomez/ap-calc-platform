"use client";

/**
 * PrereqSeeAlso — a small, unobtrusive "See also" line listing the prerequisite
 * units/topics for the current topic, each clickable to a quick refresher/lesson.
 * Shown beside a problem/lesson so a student who needs to brush up on a prerequisite
 * (sometimes in another course) can jump to it without leaving the flow.
 *
 * Sourced from /api/{system}/prereqs (math = structured prereq edges; mcat = earlier
 * topics in the unit). Renders NOTHING when there are no prerequisites, so it never
 * clutters the solving area.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface PrereqItem {
  id: string;
  label: string;
  href: string;
}

interface PrereqSeeAlsoProps {
  system: "math" | "mcat";
  course?: string;
  keywordId: string | null;
  className?: string;
  /**
   * When provided, clicking a prerequisite link opens a lesson popup in-place
   * rather than navigating to a new page. Receives the prerequisite keyword id
   * and its display label.
   */
  onOpenLesson?: (keywordId: string, label: string) => void;
}

export default function PrereqSeeAlso({
  system,
  course,
  keywordId,
  className,
  onOpenLesson,
}: PrereqSeeAlsoProps) {
  const [items, setItems] = useState<PrereqItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    if (!keywordId) return;
    const qs = new URLSearchParams({ keyword_id: keywordId });
    if (system === "math" && course) qs.set("course", course);
    fetch(`/api/${system}/prereqs?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : { prereqs: [] }))
      .then((d: { prereqs?: PrereqItem[] }) => {
        if (!cancelled) setItems((d.prereqs ?? []).slice(0, 3));
      })
      .catch(() => {
        /* fail-soft: show nothing */
      });
    return () => {
      cancelled = true;
    };
  }, [system, course, keywordId]);

  if (items.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-neutral-400 ${className ?? ""}`}
    >
      <span className="shrink-0">Shaky on a prerequisite? See also:</span>
      {items.map((it, i) => (
        <span key={it.id} className="inline-flex items-baseline">
          {onOpenLesson ? (
            <button
              type="button"
              onClick={() => onOpenLesson(it.id, it.label)}
              className="font-medium text-brand-500 hover:text-brand-700 underline underline-offset-2 transition-colors cursor-pointer"
              title={`Open lesson: ${it.label}`}
            >
              {it.label}
            </button>
          ) : (
            <Link
              href={it.href}
              className="font-medium text-brand-500 hover:text-brand-700 underline underline-offset-2 transition-colors"
              title={`Refresher: ${it.label}`}
            >
              {it.label}
            </Link>
          )}
          {i < items.length - 1 && <span className="ml-1.5 text-neutral-300">·</span>}
        </span>
      ))}
    </div>
  );
}
