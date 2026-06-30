/**
 * middleware.ts — single-page routing + API rate limiting for Lodera.
 *
 * ── ROUTING (the site is now the /v2 single page) ──────────────────────────────
 * lodera.ai IS the /v2 study app, served at the root with a clean URL. The old
 * ~45-route app is intentionally unreachable. Concretely:
 *   - `/`                → internally REWRITTEN to `/v2` (URL stays `/`).
 *   - `/v2`, `/v2/...`   → REDIRECTED to `/` (keep the URL clean; never expose /v2).
 *   - any other page     → REDIRECTED to `/` (legacy routes are gone).
 *   - `/api/*`           → passed through (the app depends on it) + rate limited.
 *   - static / _next     → excluded by the matcher (served untouched).
 * To bring the legacy app back, revert this routing block + the matcher.
 *
 * ── RATE LIMITING (/api/* only) ────────────────────────────────────────────────
 * WHY: the production DB is a tiny "Nano" Supabase instance. A single runaway
 * client, a buggy retry loop, or a scraping script can exhaust its IO and take
 * the app down. This middleware caps `/api/*` request volume per identity so
 * abuse is throttled while a normal single user is never affected.
 *
 * TIERS (max requests / window). Tune the constants below.
 *   - EXPENSIVE  20 / 10s  AI-generation & DB-heavy routes (lessons, refreshers,
 *                          search, quizzes, next-question, lookup, etc.)
 *   - AUTH       15 / 10s  /api/auth/* — abuse-sensitive (login/register).
 *   - DEFAULT   120 / 10s  everything else under /api (cheap reads/writes).
 *
 * IDENTITY: the `lodera_uid` cookie (logged-in user) is preferred; otherwise the
 * client IP from `x-forwarded-for` (first hop) or `x-real-ip`; else 'anon'.
 *
 * DISABLE: set env `RATE_LIMIT_DISABLED=1` to bypass rate limiting (routing still
 * applies). DURABLE BACKEND: set `UPSTASH_REDIS_REST_URL` + `..._TOKEN` for
 * Upstash Redis; otherwise an in-process per-instance counter is used.
 *
 * SAFETY: all logic is wrapped so any unexpected error falls through to
 * NextResponse.next() (fail-open) — a broken limiter never blocks a request.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rateLimit";

// Run on every route EXCEPT Next internals and static files (anything with a
// dot, e.g. .svg/.png/.ico). `/api/*` IS included so rate limiting still applies.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

/** The physical route segment that holds the single-page app. */
const APP_SEGMENT = "/v2";

const WINDOW_MS = 10_000;

const LIMITS = {
  expensive: 20,
  auth: 15,
  default: 120,
} as const;

// Expensive AI-generation / DB-heavy routes. Matched against the pathname.
const EXPENSIVE_PATTERNS: RegExp[] = [
  /^\/api\/(math|mcat)\/(lesson|refresher|search|quiz|next-question)/,
  /^\/api\/learn\/(lesson|refresher|tip)/,
  /^\/api\/lookup/,
];

type Tier = keyof typeof LIMITS;

function tierFor(pathname: string): Tier {
  if (pathname.startsWith("/api/auth/")) return "auth";
  for (const pattern of EXPENSIVE_PATTERNS) {
    if (pattern.test(pathname)) return "expensive";
  }
  return "default";
}

function clientIdFor(req: NextRequest): string {
  const uid = req.cookies.get("lodera_uid")?.value;
  if (uid) return `u:${uid}`;

  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }

  const real = req.headers.get("x-real-ip");
  if (real) return `ip:${real.trim()}`;

  return "anon";
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // ── Page routing (everything that isn't an /api/* call) ──────────────────────
  // The whole site is the single-page app. Map URLs onto it and bury the old app.
  if (!pathname.startsWith("/api/")) {
    try {
      // Root → render the app (URL stays "/").
      if (pathname === "/") {
        const url = req.nextUrl.clone();
        url.pathname = APP_SEGMENT;
        return NextResponse.rewrite(url);
      }
      // Never expose the /v2 path itself — send it to the clean root.
      // Any other (legacy) page route is gone → also home.
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    } catch {
      return NextResponse.next(); // fail-open
    }
  }

  // ── /api/* rate limiting ─────────────────────────────────────────────────────
  try {
    if (process.env.RATE_LIMIT_DISABLED === "1") {
      return NextResponse.next();
    }

    const tier = tierFor(pathname);
    const max = LIMITS[tier];
    const clientId = clientIdFor(req);

    const { success, remaining } = await rateLimit(
      `${tier}:${clientId}`,
      max,
      WINDOW_MS
    );

    if (!success) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(WINDOW_MS / 1000)),
            "X-RateLimit-Limit": String(max),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const res = NextResponse.next();
    res.headers.set("X-RateLimit-Limit", String(max));
    res.headers.set("X-RateLimit-Remaining", String(remaining));
    return res;
  } catch {
    // FAIL-OPEN: never block a request because the limiter itself broke.
    return NextResponse.next();
  }
}
