"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

const ACCOUNT_KEY  = "ap_calc_account_id";
const USERNAME_KEY = "ap_calc_username";
const SESSION_KEY  = "ap_calc_student_session_id";

// ── Inner form — must be wrapped in Suspense for useSearchParams ──────────────

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const nextPath     = searchParams.get("next");

  const [email,    setEmail]    = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  // If already authenticated, skip to destination
  useEffect(() => {
    fetch("/api/auth/me").then((r) => {
      if (r.ok) {
        router.replace(nextPath && nextPath.startsWith("/") ? nextPath : "/");
      }
    }).catch(() => {});
  }, [router, nextPath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password }),
      });

      const data = (await res.json()) as {
        user?: { id: string; email: string; username: string };
        sessionId?: string;
        error?: string;
      };

      if (!res.ok || !data.user) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      // Sync legacy localStorage keys so old pages keep working
      localStorage.setItem(ACCOUNT_KEY, data.user.id);
      localStorage.setItem(USERNAME_KEY, data.user.username);
      if (data.sessionId) localStorage.setItem(SESSION_KEY, data.sessionId);

      router.push(nextPath && nextPath.startsWith("/") ? nextPath : "/");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center px-4 py-16 animate-fade-in">
      {/* Logo */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <LoderaLogo size={44} withWordmark />
        <p className="text-sm text-neutral-500 text-center max-w-xs leading-relaxed">
          One account for Math and MCAT. No verification needed yet.
        </p>
      </div>

      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="lp-email" className="block text-xs font-medium text-neutral-700 mb-1">
              Email
            </label>
            <input
              id="lp-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(
                "w-full px-3 py-2 text-sm rounded-xl border border-neutral-200",
                "focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent",
                "transition-colors placeholder:text-neutral-300"
              )}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="lp-username" className="block text-xs font-medium text-neutral-700 mb-1">
              Username
            </label>
            <input
              id="lp-username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={cn(
                "w-full px-3 py-2 text-sm rounded-xl border border-neutral-200",
                "focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent",
                "transition-colors placeholder:text-neutral-300"
              )}
              placeholder="your_username"
            />
          </div>

          <div>
            <label htmlFor="lp-password" className="block text-xs font-medium text-neutral-700 mb-1">
              Password
            </label>
            <input
              id="lp-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(
                "w-full px-3 py-2 text-sm rounded-xl border border-neutral-200",
                "focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent",
                "transition-colors placeholder:text-neutral-300"
              )}
              placeholder="At least 6 characters"
            />
          </div>

          {error && (
            <p className="text-xs text-error-600 bg-error-50 border border-error-100 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            Continue
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-400 leading-relaxed">
          New here? Just fill in the form — we&apos;ll create your account automatically.
          <br />
          No verification needed yet — just remember your password.
        </p>
      </Card>
    </div>
  );
}

// Default export wraps in Suspense (required for useSearchParams in Next.js)
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
