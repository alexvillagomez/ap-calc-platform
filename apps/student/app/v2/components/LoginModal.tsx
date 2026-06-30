"use client";

/**
 * /v2 — LoginModal: a blocking in-page auth GATE.
 *
 * Replaces the /v2 "redirect to /login when unauthenticated" behavior. When a
 * logged-out visitor opens /v2 they STAY on /v2 and see this popup instead.
 *
 * It mirrors the existing /login form (app/login/page.tsx + components/auth/
 * LoginGate.tsx) EXACTLY:
 *   • Log in  → supabaseBrowser().auth.signInWithPassword({ email, password })
 *   • Sign up → POST /api/auth/signup { email, username, password }, then
 *               signInWithPassword({ email, password })
 * Both establish the Supabase GoTrue cookie session client-side. On success the
 * page re-bootstraps (its onSuccess prop reloads session + taxonomy).
 *
 * GATE behavior: no backdrop-click-to-close and no dismiss X — the user must
 * authenticate. Only the Log in / Sign up toggle is freely switchable.
 *
 * Styled to match the design's existing modals (Modals.tsx): an absolute overlay
 * inside the app card, a dimmed backdrop rgba(23,23,23,.42), a white rounded
 * card with the modal shadow.
 */

import { useState, type CSSProperties, type FormEvent } from "react";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  fontSize: 13.5,
  borderRadius: 11,
  border: "1px solid #e5e5e5",
  outline: "none",
  color: "#171717",
  background: "#fff",
  boxSizing: "border-box",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#404040",
  marginBottom: 5,
};

export function LoginModal({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  function switchMode(next: "login" | "signup") {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
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
        // Create a PRE-CONFIRMED user server-side, then sign in to establish the
        // cookie session (mirrors app/login/page.tsx exactly).
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
        const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signErr) {
          setError("Account created — please switch to Log in and sign in.");
          setMode("login");
          return;
        }
      } else {
        const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signErr) {
          setError(
            /invalid login/i.test(signErr.message)
              ? "Incorrect email or password. If you're new, switch to Sign up."
              : signErr.message
          );
          return;
        }
      }

      // Cookie session is now established → let the page re-bootstrap.
      onSuccess();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(23,23,23,.57)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 30,
        zIndex: 80,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 24px 64px rgba(0,0,0,.28)",
          width: 384,
          maxWidth: "100%",
          maxHeight: "92%",
          overflow: "auto",
          padding: "28px 28px 26px",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <LoderaLogo size={38} withWordmark />
          <p style={{ fontSize: 12.5, color: "#737373", textAlign: "center", lineHeight: 1.5, maxWidth: 260, margin: 0 }}>
            Log in or create an account to start studying.
          </p>
        </div>

        {/* Log in / Sign up toggle */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            padding: 4,
            borderRadius: 12,
            background: "#f5f5f5",
            marginBottom: 18,
          }}
        >
          <button
            type="button"
            onClick={() => switchMode("login")}
            style={{
              padding: "7px 0",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 9,
              border: "none",
              cursor: "pointer",
              background: !isSignup ? "#fff" : "transparent",
              color: !isSignup ? "#171717" : "#737373",
              boxShadow: !isSignup ? "0 1px 2px rgba(0,0,0,.06)" : "none",
            }}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => switchMode("signup")}
            style={{
              padding: "7px 0",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 9,
              border: "none",
              cursor: "pointer",
              background: isSignup ? "#fff" : "transparent",
              color: isSignup ? "#171717" : "#737373",
              boxShadow: isSignup ? "0 1px 2px rgba(0,0,0,.06)" : "none",
            }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <div>
            <label htmlFor="v2-login-email" style={labelStyle}>
              Email
            </label>
            <input
              id="v2-login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>

          {isSignup && (
            <div>
              <label htmlFor="v2-login-username" style={labelStyle}>
                Username
              </label>
              <input
                id="v2-login-username"
                type="text"
                autoComplete="username"
                required={isSignup}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your_username"
                style={inputStyle}
              />
            </div>
          )}

          <div>
            <label htmlFor="v2-login-password" style={labelStyle}>
              Password
            </label>
            <input
              id="v2-login-password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? "At least 6 characters" : "Your password"}
              style={inputStyle}
            />
          </div>

          {isSignup && (
            <div>
              <label htmlFor="v2-login-confirm" style={labelStyle}>
                Confirm password
              </label>
              <input
                id="v2-login-confirm"
                type="password"
                autoComplete="new-password"
                required={isSignup}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                style={inputStyle}
              />
            </div>
          )}

          {error && (
            <p
              style={{
                fontSize: 12,
                color: "#be123c",
                background: "#fff1f2",
                border: "1px solid #fecdd3",
                borderRadius: 11,
                padding: "8px 12px",
                margin: 0,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              height: 46,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 13,
              boxShadow: "0 2px 8px 0 rgba(59,130,246,.28)",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading && (
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 9999,
                  border: "2px solid rgba(255,255,255,.5)",
                  borderTopColor: "#fff",
                  animation: "ldSpin 0.8s linear infinite",
                }}
              />
            )}
            {loading ? "Please wait…" : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <p style={{ marginTop: 16, textAlign: "center", fontSize: 12, color: "#737373", lineHeight: 1.5 }}>
          {isSignup ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("login")}
                style={{ border: "none", background: "transparent", color: "#4f46e5", fontWeight: 700, cursor: "pointer", padding: 0 }}
              >
                Log in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                style={{ border: "none", background: "transparent", color: "#4f46e5", fontWeight: 700, cursor: "pointer", padding: 0 }}
              >
                Sign up
              </button>
            </>
          )}
          <br />
          No verification needed yet — just remember your password.
        </p>
      </div>
    </div>
  );
}
