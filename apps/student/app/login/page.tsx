"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// ── Inner form — must be wrapped in Suspense for useSearchParams ──────────────

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const nextPath     = searchParams.get("next");

  const [mode,     setMode]     = useState<"login" | "signup">("login");
  const [email,    setEmail]    = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  const isSignup = mode === "signup";
  const switchMode = (next: "login" | "signup") => { setMode(next); setError(null); };

  // Where to send the user after auth. Honor an explicit ?next= first; otherwise
  // fall back to the course they chose during onboarding (lodera_last_center) so a
  // signup that started from MCAT lands on /mcat, not the default /math. This fixes
  // the "post-signup redirect to the wrong course" bug.
  const destination = (): string => {
    if (nextPath && nextPath.startsWith("/")) return nextPath;
    if (typeof window !== "undefined") {
      const last = window.localStorage.getItem("lodera_last_center");
      if (last === "mcat") return "/mcat";
      if (last === "math") return "/math";
    }
    return "/";
  };

  // If already authenticated (Supabase session), skip to destination.
  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth
      .getUser()
      .then((res: { data: { user: { id: string } | null } }) => {
        if (res.data.user) {
          router.replace(destination());
        }
      });
  }, [router, nextPath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isSignup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = supabaseBrowser();

    try {
      if (isSignup) {
        // Create a PRE-CONFIRMED user server-side (admin API) so signup never
        // sends a confirmation email (avoids GoTrue's email rate limit) and works
        // regardless of the project's "Confirm email" setting. Then sign in to
        // establish the cookie session → instant login.
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, username, password }),
        });
        const data = (await res.json()) as { error?: string; code?: string };
        if (!res.ok) {
          if (data.code === "email_exists") setMode("login");
          setError(data.error ?? "Could not create account. Please try again.");
          return;
        }
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signErr) {
          setError(
            "Account created — please switch to Log in and sign in."
          );
          setMode("login");
          return;
        }
      } else {
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signErr) {
          setError(
            /invalid login/i.test(signErr.message)
              ? "Incorrect email or password. If you're new, switch to Sign up."
              : signErr.message
          );
          return;
        }
      }

      router.push(destination());
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

          {isSignup && (
            <div>
              <label htmlFor="lp-confirm-password" className="block text-xs font-medium text-neutral-700 mb-1">
                Confirm password
              </label>
              <input
                id="lp-confirm-password"
                type="password"
                autoComplete="new-password"
                required={isSignup}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={cn(
                  "w-full px-3 py-2 text-sm rounded-xl border border-neutral-200",
                  "focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent",
                  "transition-colors placeholder:text-neutral-300"
                )}
                placeholder="Re-enter your password"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-error-600 bg-error-50 border border-error-100 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            {isSignup ? "Create account" : "Log in"}
          </Button>

          {!isSignup && (
            <div className="text-center">
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-neutral-500 hover:text-brand-600 transition-colors"
              >
                Forgot password?
              </Link>
            </div>
          )}
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
