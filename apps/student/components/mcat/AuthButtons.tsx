"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

/**
 * Login / logout control for the MCAT header.
 * - Logged out: "Log in" button → /login?next=/mcat
 * - Logged in: shows the username + "Log out" (signs out of Supabase Auth so
 *   the next visitor starts as a fresh guest).
 */
export default function AuthButtons() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    supabaseBrowser()
      .auth.getUser()
      .then((res: { data: { user: { email?: string; user_metadata?: { username?: string } } | null } }) => {
        if (!active) return;
        const user = res.data.user;
        if (user) {
          const meta = user.user_metadata ?? {};
          setUsername(meta.username || user.email || "Account");
        } else {
          setUsername(null);
        }
        setReady(true);
      })
      .catch(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  const handleLogout = async () => {
    try { await supabaseBrowser().auth.signOut(); } catch { /* ignore */ }
    setUsername(null);
    window.location.href = "/mcat";
  };

  if (!ready) {
    return <div className="w-16 h-7" aria-hidden />;
  }

  if (username) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/profile"
          className="text-xs font-medium text-neutral-600 hover:text-brand-600 transition-colors px-2 py-1"
        >
          {username}
        </Link>
        <button
          onClick={handleLogout}
          className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => router.push("/login?next=/mcat")}
      className="px-3 py-1.5 rounded-xl bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 transition-colors shadow-brand-sm"
    >
      Log in
    </button>
  );
}
