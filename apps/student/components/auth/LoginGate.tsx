"use client";

/**
 * LoginGate — wraps any page that requires a Lodera account.
 *
 * If the user is not logged in (no "lodera_uid" httpOnly cookie — detected via
 * GET /api/auth/me), shows the unified login/auto-signup form inline instead
 * of the page content. On success the user sees the wrapped content immediately.
 *
 * For hard redirects, use the /login?next= page directly.
 */

import { useState, useEffect, useCallback } from "react";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

const ACCOUNT_KEY   = "ap_calc_account_id";
const USERNAME_KEY  = "ap_calc_username";
const SESSION_KEY   = "ap_calc_student_session_id";

interface User {
  id: string;
  email: string;
  username: string;
}

interface LoginGateProps {
  children: React.ReactNode;
  /** Shown above the form; e.g. "Sign in to access MCAT Practice" */
  prompt?: string;
}

export function LoginGate({ children, prompt }: LoginGateProps) {
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  // Check cookie-backed session on mount
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (r.ok) return r.json() as Promise<{ user: User }>;
        throw new Error("unauthenticated");
      })
      .then(({ user: u }) => {
        // Keep localStorage in sync for legacy pages
        localStorage.setItem(ACCOUNT_KEY, u.id);
        localStorage.setItem(USERNAME_KEY, u.username);
        setStatus("authenticated");
      })
      .catch(() => setStatus("unauthenticated"));
  }, []);

  const handleLogin = useCallback((u: User, sessionId: string) => {
    localStorage.setItem(ACCOUNT_KEY, u.id);
    localStorage.setItem(USERNAME_KEY, u.username);
    localStorage.setItem(SESSION_KEY, sessionId);
    setStatus("authenticated");
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <LoginScreen prompt={prompt} onLogin={handleLogin} />;
  }

  // Re-render children with user context available
  return <>{children}</>;
}

// ── Login screen ──────────────────────────────────────────────────────────────

interface LoginScreenProps {
  prompt?: string;
  onLogin: (user: User, sessionId: string) => void;
}

function LoginScreen({ prompt, onLogin }: LoginScreenProps) {
  const [email,    setEmail]    = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

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
        user?: User;
        sessionId?: string;
        error?: string;
      };
      if (!res.ok || !data.user) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      onLogin(data.user, data.sessionId ?? "");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center px-4 py-16">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <LoderaLogo size={40} withWordmark />
        {prompt && (
          <p className="text-sm text-neutral-500 text-center max-w-xs leading-relaxed">{prompt}</p>
        )}
      </div>

      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="lg-email" className="block text-xs font-medium text-neutral-700 mb-1">
              Email
            </label>
            <input
              id="lg-email"
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
            <label htmlFor="lg-username" className="block text-xs font-medium text-neutral-700 mb-1">
              Username
            </label>
            <input
              id="lg-username"
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
            <label htmlFor="lg-password" className="block text-xs font-medium text-neutral-700 mb-1">
              Password
            </label>
            <input
              id="lg-password"
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
          No verification needed yet — just remember your password.
        </p>
      </Card>
    </div>
  );
}

export default LoginGate;
