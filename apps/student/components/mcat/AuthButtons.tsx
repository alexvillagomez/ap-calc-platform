"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const ACCOUNT_KEY = "ap_calc_account_id";
const USERNAME_KEY = "ap_calc_username";
const SESSION_KEY = "ap_calc_student_session_id";
const DIAG_DONE_KEY = "ap_calc_diagnostic_done";

/**
 * Login / logout control for the MCAT header.
 * - Logged out: "Log in" button → /login?next=/mcat
 * - Logged in: shows the username + "Log out" (clears the account + session so
 *   the next visitor starts as a fresh guest).
 */
export default function AuthButtons() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    setUsername(accountId ? localStorage.getItem(USERNAME_KEY) : null);
    setReady(true);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(DIAG_DONE_KEY);
    setUsername(null);
    // Full reload so every page re-bootstraps a fresh guest session.
    window.location.href = "/mcat";
  };

  if (!ready) {
    // Reserve space to avoid header layout shift.
    return <div className="w-16 h-7" aria-hidden />;
  }

  if (username) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 hidden sm:inline">
          {username}
        </span>
        <button
          onClick={handleLogout}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => router.push("/login?next=/mcat")}
      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
    >
      Log in
    </button>
  );
}
