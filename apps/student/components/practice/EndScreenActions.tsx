"use client";

import Link from "next/link";

/**
 * A single "what next?" action shown on an end-of-activity screen (lesson done,
 * flashcard set done, etc.). Either a navigation (`href`) or a callback (`onClick`).
 */
export interface EndAction {
  label: string;
  sublabel?: string;
  href?: string;
  onClick?: () => void;
  /** Primary (filled brand) vs secondary (outline). First action is usually primary. */
  primary?: boolean;
}

/**
 * Standard end-of-activity action menu — a vertical stack of choices so the
 * student is never dumped to a dead end. Used after standalone lessons,
 * flashcard sets, and (optionally) quizzes to offer "practice more of this
 * topic / back to the topic / home" instead of a single forced redirect.
 */
export function EndScreenActions({ actions }: { actions: EndAction[] }) {
  const visible = actions.filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {visible.map((a, i) => {
        const cls = a.primary
          ? "w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors text-center"
          : "w-full py-3 rounded-xl border border-neutral-200 bg-white text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors text-center";

        const inner = (
          <>
            {a.label}
            {a.sublabel && (
              <span className="block text-xs font-normal opacity-70 mt-0.5">
                {a.sublabel}
              </span>
            )}
          </>
        );

        if (a.href) {
          return (
            <Link key={i} href={a.href} className={cls}>
              {inner}
            </Link>
          );
        }
        return (
          <button key={i} type="button" onClick={a.onClick} className={cls}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}
