"use client";

/**
 * NavMenu — the shared, always-present account + navigation cluster.
 *
 * Drop this into the right side of any page header. It provides three things
 * the rest of the app needs everywhere:
 *   1. Account access      — avatar button → dropdown with "Account" (/profile).
 *   2. Section switching    — a Math | MCAT toggle inside the dropdown that
 *      lands on the relevant portal home.
 *   3. Course Portal link   — "Course Portal" (/portal), the Math-vs-MCAT chooser.
 *   Plus Sound on/off toggle and Log out.
 *
 * The current section is auto-detected from the pathname, so every page can
 * render `<NavMenu />` with no props and get the correct switcher highlight.
 *
 * If the visitor is not signed in, the avatar collapses to a "Log in" button
 * (so the component is safe to render on public pages like /portal).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { cn } from "@/lib/cn";
import { useSoundPreference } from "@/components/ui/SoundToggle";
import MyProgressChip from "@/components/gamification/MyProgressChip";

const USERNAME_KEY    = "ap_calc_username";
const LAST_CENTER_KEY = "lodera_last_center";

type Section = "math" | "mcat" | null;

function sectionFromPath(pathname: string | null): Section {
  if (!pathname) return null;
  if (pathname.startsWith("/mcat")) return "mcat";
  if (pathname.startsWith("/math")) return "math";
  return null;
}

interface NavMenuProps {
  /** Override the auto-detected section (rarely needed). */
  section?: Section;
  className?: string;
}

export function NavMenu({ section: sectionProp, className }: NavMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const section = sectionProp ?? sectionFromPath(pathname);

  const [name, setName]       = useState<string | null>(null);
  const [authed, setAuthed]   = useState<boolean | null>(null); // null = loading
  const [open, setOpen]       = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { muted, toggleMute } = useSoundPreference();

  // Resolve the signed-in user (cookie-backed). Falls back to the legacy
  // localStorage username instantly so the avatar doesn't flicker.
  useEffect(() => {
    let active = true;
    try {
      const cached = localStorage.getItem(USERNAME_KEY);
      if (cached) { setName(cached); setAuthed(true); }
    } catch { /* ignore */ }

    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { username?: string; display_name?: string | null; email?: string } } | null) => {
        if (!active) return;
        if (d?.user) {
          const display = d.user.display_name?.trim() || d.user.username || d.user.email || "Account";
          setName(display);
          setAuthed(true);
        } else {
          setAuthed(false);
        }
      })
      .catch(() => { if (active) setAuthed(false); });
    return () => { active = false; };
  }, []);

  // Close the dropdown on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const goSection = useCallback((s: "math" | "mcat") => {
    setOpen(false);
    if (s === section) return; // already here
    try { localStorage.setItem(LAST_CENTER_KEY, s); } catch { /* ignore */ }
    router.push(s === "math" ? "/math" : "/mcat");
  }, [router, section]);

  const handleLogout = useCallback(async () => {
    setOpen(false);
    try { await supabaseBrowser().auth.signOut(); } catch { /* ignore */ }
    router.push("/login");
  }, [router]);

  const initial = (name || "?").charAt(0).toUpperCase();

  // ── Logged-out fallback ──────────────────────────────────────────────────
  if (authed === false) {
    return (
      <button
        onClick={() => router.push(`/login${pathname ? `?next=${encodeURIComponent(pathname)}` : ""}`)}
        className="px-3 py-1.5 rounded-xl bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 transition-colors shadow-brand-sm"
      >
        Log in
      </button>
    );
  }

  // While auth is resolving, reserve space to avoid layout shift.
  if (authed === null) {
    return <div className={cn("h-8 w-8 rounded-full bg-neutral-100 animate-pulse", className)} aria-hidden />;
  }

  return (
    <div ref={wrapRef} className={cn("flex items-center gap-2", className)}>
      {/* My Progress points chip — present in every app header via NavMenu */}
      <MyProgressChip />
      {/* Avatar + dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-sm font-semibold hover:bg-brand-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {initial}
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border border-neutral-200 bg-white shadow-brand-md py-1.5 z-50 animate-fade-in"
          >
            {name && (
              <div className="px-3 pb-1.5 pt-0.5 border-b border-neutral-100 mb-1">
                <p className="text-xs text-neutral-400">Signed in as</p>
                <p className="text-sm font-medium text-neutral-800 truncate">{name}</p>
              </div>
            )}

            {/* Section switch — always present (covers mobile, where the inline toggle is hidden) */}
            <div className="px-1.5 py-1">
              <p className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Switch course</p>
              <div className="flex gap-1">
                <button
                  onClick={() => goSection("math")}
                  className={cn(
                    "flex-1 px-2 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                    section === "math" ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200" : "text-neutral-600 hover:bg-neutral-50"
                  )}
                >
                  Math
                </button>
                <button
                  onClick={() => goSection("mcat")}
                  className={cn(
                    "flex-1 px-2 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                    section === "mcat" ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200" : "text-neutral-600 hover:bg-neutral-50"
                  )}
                >
                  MCAT
                </button>
              </div>
            </div>

            <div className="my-1 border-t border-neutral-100" />

            <MenuItem href="/portal" label="Course Portal" onClick={() => setOpen(false)} />
            <MenuItem href="/profile" label="Account" onClick={() => setOpen(false)} />
            <button
              role="menuitem"
              onClick={toggleMute}
              className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors flex items-center gap-2"
            >
              {muted ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-neutral-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-neutral-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
              {muted ? "Sound off" : "Sound on"}
            </button>

            <div className="my-1 border-t border-neutral-100" />

            <button
              role="menuitem"
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ href, label, onClick }: { href: string; label: string; onClick: () => void }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="block px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
    >
      {label}
    </Link>
  );
}

export default NavMenu;
