"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const ACCOUNT_KEY = "ap_calc_account_id";
const USERNAME_KEY = "ap_calc_username";
const SESSION_KEY = "ap_calc_student_session_id";
const DIAG_DONE_KEY = "ap_calc_diagnostic_done";

// Inner component that actually calls useSearchParams — must be wrapped in <Suspense>
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");

  // Read ?register=1 on mount and switch to register tab
  useEffect(() => {
    if (searchParams.get("register") === "1") {
      setMode("register");
    }
  }, [searchParams]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";

    try {
      const payload: { username: string; password: string; existingSessionId?: string } = {
        username: username.trim(),
        password,
      };
      if (mode === "register") {
        const guestSessionId = localStorage.getItem(SESSION_KEY);
        if (guestSessionId) payload.existingSessionId = guestSessionId;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as {
        accountId?: string;
        username?: string;
        sessionId?: string;
        diagnosticCompletedAt?: string | null;
        error?: string;
      };

      if (!res.ok || !data.accountId || !data.sessionId) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      localStorage.setItem(ACCOUNT_KEY, data.accountId);
      localStorage.setItem(USERNAME_KEY, data.username ?? username);
      localStorage.setItem(SESSION_KEY, data.sessionId);
      // Honor an explicit ?next= destination (e.g. the MCAT app) when present.
      const next = searchParams.get("next");
      if (next && next.startsWith("/")) {
        if (data.diagnosticCompletedAt) localStorage.setItem(DIAG_DONE_KEY, "1");
        else localStorage.removeItem(DIAG_DONE_KEY);
        router.push(next);
      } else if (data.diagnosticCompletedAt) {
        localStorage.setItem(DIAG_DONE_KEY, "1");
        router.push("/demo-practice");
      } else {
        localStorage.removeItem(DIAG_DONE_KEY);
        router.push("/demo");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-xl font-semibold text-gray-900">Login</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {/* Mode tabs */}
          <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-label={m === "register" ? "Switch to create account" : "Switch to log in"}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode === m
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => { setMode(m); setError(null); }}
              >
                {m === "login" ? "Log In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-xs font-medium text-gray-700 mb-1">Username</label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="your_username"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-gray-700 mb-1">Password</label>
              <input
                id="login-password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={mode === "register" ? "At least 6 characters" : ""}
              />
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  {mode === "login" ? "Logging in…" : "Creating account…"}
                </>
              ) : mode === "login" ? "Log In" : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// Default export wraps LoginForm in Suspense so useSearchParams() is valid
// during the production build's static generation pass.
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4" />
    }>
      <LoginForm />
    </Suspense>
  );
}
