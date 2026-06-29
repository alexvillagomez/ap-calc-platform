"use client";

/**
 * MyProgressChip — the always-visible "My Progress" entry point in every app
 * header. Shows today's points and animates a floating "+N" when points are
 * awarded.
 *
 * Click behaviour:
 *  - On a HOME route (/, /math, /mcat, a /math/<course> home) → navigate to the
 *    section's full progress page (points + mastery report).
 *  - Anywhere else → open an in-page popup with the points breakdown plus a
 *    "See full progress" link (so the student isn't yanked out of practice).
 *
 * The full destination is section-aware so "My Progress" keeps everything it
 * used to show: /mcat → /mcat/progress, /math/<course> → that course's progress.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { getPoints, subscribePoints } from "@/lib/points";
import MyProgressPanel from "./MyProgressPanel";

/** A "home" surface where the chip navigates straight to the full report. */
function isHomeRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/" || pathname === "/mcat" || pathname === "/math") return true;
  return /^\/math\/[^/]+$/.test(pathname); // a /math/<course> course home
}

/** The section-appropriate full progress page (points + mastery report). */
function progressHrefFor(pathname: string | null): string {
  if (!pathname) return "/my-progress";
  if (pathname.startsWith("/mcat")) return "/mcat/progress";
  const m = pathname.match(/^\/math\/([^/]+)/);
  if (m) return `/math/${m[1]}/progress`;
  return "/my-progress";
}

interface MyProgressChipProps {
  className?: string;
}

export default function MyProgressChip({ className }: MyProgressChipProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [today, setToday] = useState(0);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Floating "+N" celebration on award.
  const [gain, setGain] = useState<{ key: number; amount: number } | null>(null);
  const gainKey = useRef(0);
  const prevToday = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const initial = getPoints();
    prevToday.current = initial.today;
    setToday(initial.today);
    return subscribePoints((s) => {
      const prev = prevToday.current ?? s.today;
      const delta = s.today - prev;
      prevToday.current = s.today;
      setToday(s.today);
      if (delta > 0) {
        gainKey.current += 1;
        setGain({ key: gainKey.current, amount: delta });
        window.setTimeout(() => {
          setGain((g) => (g && g.key === gainKey.current ? null : g));
        }, 900);
      }
    });
  }, []);

  // Lock background scroll + close on Esc while the popup is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const progressHref = progressHrefFor(pathname);

  const onClick = useCallback(() => {
    if (pathname === progressHref) return; // already on the full report
    if (isHomeRoute(pathname)) {
      router.push(progressHref);
    } else {
      setOpen(true);
    }
  }, [pathname, router, progressHref]);

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1",
          "bg-white border border-neutral-200 text-neutral-700 shadow-brand-xs",
          "text-xs font-semibold select-none transition-colors hover:border-brand-300 hover:text-brand-700",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        )}
        aria-label={`My progress: ${today} point${today === 1 ? "" : "s"} today. Tap to view.`}
        title="My Progress"
      >
        {/* Upward-trend spark */}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
          <defs>
            <linearGradient id="myprogress-grad" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <path
            d="M1.5 8.5L4.5 5.5L6.5 7.5L10.5 3.5"
            fill="none"
            stroke="url(#myprogress-grad)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M8 3.5h2.5V6" fill="none" stroke="url(#myprogress-grad)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="tabular-nums">{today}</span>
        <span className="font-medium text-neutral-400">pts</span>
      </button>

      {/* Floating "+N" */}
      {gain && (
        <span
          key={`gain-${gain.key}`}
          aria-hidden
          className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-brand-500 pointer-events-none motion-safe:animate-[lodera-float-up_800ms_ease-out_forwards]"
        >
          +{gain.amount}
        </span>
      )}

      {/* Popup (off-home) */}
      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-neutral-900/50 p-4 backdrop-blur-sm sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="My Progress"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="relative my-auto w-full max-w-sm rounded-2xl bg-neutral-50 p-5 shadow-brand-lg">
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute right-3 top-3 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <MyProgressPanel />
              <button
                onClick={() => {
                  setOpen(false);
                  router.push(progressHref);
                }}
                className="mt-4 w-full rounded-xl border border-brand-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
              >
                See full progress →
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
