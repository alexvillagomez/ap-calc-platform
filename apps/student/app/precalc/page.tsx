"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const SESSION_KEY = "ap_calc_student_session_id";
const ACCOUNT_KEY = "ap_calc_account_id";
const USERNAME_KEY = "ap_calc_username";

type AuthTab = "signin" | "register";
type Phase = "auth" | "topics";
type Topic = { id: string; label: string };

export default function PrecalcPortal() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("auth");
  const [tab, setTab] = useState<AuthTab>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [storedUsername, setStoredUsername] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [showTopics, setShowTopics] = useState(false);

  useEffect(() => {
    const sid = localStorage.getItem(SESSION_KEY);
    const uname = localStorage.getItem(USERNAME_KEY);
    if (sid && uname) {
      setStoredUsername(uname);
      setPhase("topics");
      loadTopics();
    }
  }, []);

  async function loadTopics() {
    setTopicsLoading(true);
    try {
      const res = await fetch("/api/learn/topics");
      const data = await res.json() as { topics?: Topic[] };
      setTopics(data.topics ?? []);
    } catch {
      setTopics([]);
    } finally {
      setTopicsLoading(false);
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = tab === "signin" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json() as { accountId?: string; username?: string; sessionId?: string; error?: string };
      if (!res.ok || !data.sessionId) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      localStorage.setItem(SESSION_KEY, data.sessionId);
      localStorage.setItem(ACCOUNT_KEY, data.accountId ?? "");
      localStorage.setItem(USERNAME_KEY, data.username ?? username.trim());
      setStoredUsername(data.username ?? username.trim());
      setPhase("topics");
      loadTopics();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSignOut() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(USERNAME_KEY);
    setPhase("auth");
    setStoredUsername("");
    setTopics([]);
    setUsername("");
    setPassword("");
  }

  if (phase === "topics") {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Precalc Primer</h1>
              <p className="text-sm text-gray-500 mt-1">Welcome back, {storedUsername}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Sign out
            </button>
          </div>

          {/* Subtitle */}
          <p className="text-gray-600 font-medium">What do you want to work on today?</p>

          {/* Mode cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Card 1 — Recommended Path (full width, prominent) */}
            <button
              onClick={() => router.push("/precalc/diagnostic")}
              className="sm:col-span-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-2xl p-8 text-left shadow-sm hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-blue-200 uppercase tracking-wider mb-2">Recommended</p>
                  <p className="text-xl font-bold text-white group-hover:text-white transition-colors">
                    Recommended Path
                  </p>
                  <p className="text-sm text-blue-100 mt-2 max-w-sm">
                    Personalized diagnostic → lessons → practice. Adapts to you.
                  </p>
                </div>
                <span className="text-white text-2xl font-light opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition-all mt-1">
                  →
                </span>
              </div>
              <p className="text-sm text-white font-semibold mt-6 group-hover:translate-x-0.5 transition-transform">
                Start →
              </p>
            </button>

            {/* Card 2 — Free Practice */}
            <button
              onClick={() => router.push("/precalc/practice")}
              className="bg-white border-2 border-violet-200 hover:border-violet-400 rounded-2xl p-6 text-left shadow-sm hover:shadow-md transition-all group"
            >
              <p className="text-base font-bold text-gray-900 group-hover:text-violet-700 transition-colors">
                Free Practice
              </p>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                Jump straight into problems. Tips available if you get stuck.
              </p>
              <p className="text-xs text-violet-600 font-semibold mt-5 group-hover:translate-x-0.5 transition-transform">
                Practice →
              </p>
            </button>

            {/* Card 3 — Browse Lessons (toggle expand) */}
            <button
              onClick={() => {
                setShowTopics((prev) => !prev);
              }}
              className={`bg-white border-2 rounded-2xl p-6 text-left shadow-sm hover:shadow-md transition-all group ${
                showTopics
                  ? "border-green-400"
                  : "border-green-200 hover:border-green-400"
              }`}
            >
              <div className="flex items-start justify-between">
                <p className="text-base font-bold text-gray-900 group-hover:text-green-700 transition-colors">
                  Lessons
                </p>
                <span
                  className={`text-green-500 text-sm font-semibold transition-transform duration-200 ${
                    showTopics ? "rotate-90" : ""
                  }`}
                >
                  ›
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                Browse topics and work through lessons at your own pace.
              </p>
              <p className="text-xs text-green-600 font-semibold mt-5 group-hover:translate-x-0.5 transition-transform">
                Browse →
              </p>
            </button>

            {/* Card 4 — Problem Lookup */}
            <button
              onClick={() => router.push("/lookup")}
              className="bg-white border-2 border-amber-200 hover:border-amber-400 rounded-2xl p-6 text-left shadow-sm hover:shadow-md transition-all group"
            >
              <p className="text-base font-bold text-gray-900 group-hover:text-amber-700 transition-colors">
                Problem Lookup
              </p>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                Describe the type of problem you want to practice.
              </p>
              <p className="text-xs text-amber-600 font-semibold mt-5 group-hover:translate-x-0.5 transition-transform">
                Search →
              </p>
            </button>

            {/* Card 5 — Progress */}
            <button
              onClick={() => router.push("/progress")}
              className="bg-white border-2 border-gray-200 hover:border-gray-400 rounded-2xl p-6 text-left shadow-sm hover:shadow-md transition-all group"
            >
              <p className="text-base font-bold text-gray-900 group-hover:text-gray-700 transition-colors">
                My Progress
              </p>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                See your keyword strengths, weaknesses, and mastered skills.
              </p>
              <p className="text-xs text-gray-500 font-semibold mt-5 group-hover:translate-x-0.5 transition-transform">
                View →
              </p>
            </button>
          </div>

          {/* Expanded topics list for Browse Lessons */}
          {showTopics && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Select a topic</p>
              {topicsLoading ? (
                <p className="text-sm text-gray-400">Loading topics…</p>
              ) : topics.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                  Lessons are being prepared. Try the recommended path or free practice for now.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {topics.map((topic) => (
                    <button
                      key={topic.id}
                      onClick={() => router.push(`/learn?topic=${topic.id}`)}
                      className="bg-white border border-gray-200 hover:border-green-400 rounded-2xl p-5 text-left hover:shadow-sm transition-all group"
                    >
                      <p className="font-semibold text-gray-900 group-hover:text-green-700 transition-colors text-sm">
                        {topic.label}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">Diagnostic → Lesson → Practice</p>
                      <p className="text-xs text-green-600 font-medium mt-3 group-hover:translate-x-0.5 transition-transform">
                        Start →
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Auth phase
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-2xl mb-4">
            <span className="text-white text-xl font-bold">P</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Precalc Primer</h1>
          <p className="text-sm text-gray-500 mt-1">Adaptive precalculus practice</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
          {/* Tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => { setTab("signin"); setError(""); }}
              className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
                tab === "signin" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Sign In
            </button>
            <button
              aria-label="Switch to create account"
              onClick={() => { setTab("register"); setError(""); }}
              className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
                tab === "register" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleAuth} className="space-y-3">
            <div>
              <label htmlFor="precalc-username" className="text-xs font-medium text-gray-600 block mb-1">Username</label>
              <input
                id="precalc-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your username"
                autoComplete="username"
                required
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="precalc-password" className="text-xs font-medium text-gray-600 block mb-1">Password</label>
              <input
                id="precalc-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={tab === "signin" ? "current-password" : "new-password"}
                required
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {error && (
              <p className="text-xs text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
            >
              {loading ? "…" : tab === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
