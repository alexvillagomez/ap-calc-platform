/**
 * middleware.ts — API rate limiting for the Lodera student app.
 *
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
 * DISABLE: set env `RATE_LIMIT_DISABLED=1` to bypass entirely.
 * DURABLE BACKEND: set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` to
 *   use Upstash Redis (works on the edge); otherwise an in-process per-instance
 *   counter is used. See lib/rateLimit.ts.
 *
 * SAFETY: the matcher restricts this to `/api/*` only, and all logic is wrapped
 * so any unexpected error falls through to NextResponse.next() (fail-open).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rateLimit";

export const config = {
  matcher: ["/api/:path*"],
};

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
  try {
    if (process.env.RATE_LIMIT_DISABLED === "1") {
      return NextResponse.next();
    }

    const pathname = req.nextUrl.pathname;
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
