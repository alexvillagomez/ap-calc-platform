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

  const [mode,     setMode]     = useState<"login" | "signup">("login");
  const [email,    setEmail]    = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  const isSignup = mode === "signup";
  const switchMode = (next: "login" | "signup") => { setMode(next); setError(null); };

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
        body: JSON.stringify({ email, username: isSignup ? username : undefined, password, mode }),
      });

      const data = (await res.json()) as {
        user?: { id: string; email: string; username: string };
        sessionId?: string;
        error?: string;
        code?: string;
      };

      if (!res.ok || !data.user) {
        if (data.code === "email_exists") setMode("login");
        else if (data.code === "no_account") setMode("signup");
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
        {/* Log in / Sign up toggle */}
        <div className="mb-5 grid grid-cols-2 gap-1 p-1 rounded-xl bg-neutral-100">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={cn(
              "py-1.5 text-sm font-medium rounded-lg transition-colors",
              !isSignup ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            )}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => switchMode("signup")}
            className={cn(
              "py-1.5 text-sm font-medium rounded-lg transition-colors",
              isSignup ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            )}
          >
            Sign up
          </button>
        </div>

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

          {isSignup && (
            <div>
              <label htmlFor="lp-username" className="block text-xs font-medium text-neutral-700 mb-1">
                Username
              </label>
              <input
                id="lp-username"
                type="text"
                autoComplete="username"
                required={isSignup}
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
          )}

          <div>
            <label htmlFor="lp-password" className="block text-xs font-medium text-neutral-700 mb-1">
              Password
            </label>
            <input
              id="lp-password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(
                "w-full px-3 py-2 text-sm rounded-xl border border-neutral-200",
                "focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent",
                "transition-colors placeholder:text-neutral-300"
              )}
              placeholder={isSignup ? "At least 6 characters" : "Your password"}
            />
          </div>

          {error && (
            <p className="text-xs text-error-600 bg-error-50 border border-error-100 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            {isSignup ? "Create account" : "Log in"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-500 leading-relaxed">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("login")} className="font-semibold text-brand-600 hover:text-brand-700">
                Log in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button type="button" onClick={() => switchMode("signup")} className="font-semibold text-brand-600 hover:text-brand-700">
                Sign up
              </button>
            </>
          )}
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
