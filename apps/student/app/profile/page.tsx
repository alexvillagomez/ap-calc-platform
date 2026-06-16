"use client";

/**
 * Profile / account page.
 *
 * Wrapped in LoginGate so only signed-in users reach the content.
 * Sections:
 *   - Account header (avatar/initial, display name, email, member-since, streak)
 *   - Personal information (editable) → PUT /api/auth/user
 *   - Security (change password)       → PUT /api/auth/password
 *   - Subscription (stub — Free plan)
 *   - Log out
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LoginGate } from "@/components/auth/LoginGate";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

const ACCOUNT_KEY = "ap_calc_account_id";
const USERNAME_KEY = "ap_calc_username";
const SESSION_KEY = "ap_calc_student_session_id";
const DIAG_DONE_KEY = "ap_calc_diagnostic_done";

interface MeUser {
  id: string;
  email: string;
  username: string;
  created_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  grade_level?: string | null;
  target_exam_date?: string | null;
  updated_at?: string | null;
}

interface MeResponse {
  user: MeUser;
  streak?: { current_streak: number; longest_streak: number };
}

const inputClass = cn(
  "w-full px-3 py-2 text-sm rounded-xl border border-neutral-200",
  "focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent",
  "transition-colors placeholder:text-neutral-300"
);

const labelClass = "block text-xs font-medium text-neutral-700 mb-1";

function formatMemberSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function ProfilePage() {
  return (
    <LoginGate prompt="Sign in to manage your account">
      <ProfileContent />
    </LoginGate>
  );
}

function ProfileContent() {
  const router = useRouter();

  const [me, setMe] = useState<MeUser | null>(null);
  const [streak, setStreak] = useState(0);
  const [loadingMe, setLoadingMe] = useState(true);

  // Personal-info form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [targetExamDate, setTargetExamDate] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);

  // Security form fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [loggingOut, setLoggingOut] = useState(false);

  const hydrate = useCallback((u: MeUser) => {
    setMe(u);
    setFirstName(u.first_name ?? "");
    setLastName(u.last_name ?? "");
    setDisplayName(u.display_name ?? "");
    setGradeLevel(u.grade_level ?? "");
    setTargetExamDate(u.target_exam_date ? u.target_exam_date.slice(0, 10) : "");
    setUsername(u.username ?? "");
    setEmail(u.email ?? "");
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : Promise.reject(new Error("me"))))
      .then((data) => {
        if (!active) return;
        hydrate(data.user);
        setStreak(data.streak?.current_streak ?? 0);
      })
      .catch(() => {
        /* LoginGate guarantees auth; ignore transient errors */
      })
      .finally(() => {
        if (active) setLoadingMe(false);
      });
    return () => {
      active = false;
    };
  }, [hydrate]);

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.error("Username cannot be empty.");
      return;
    }
    setSavingInfo(true);
    try {
      const res = await fetch("/api/auth/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          display_name: displayName.trim(),
          grade_level: gradeLevel.trim(),
          target_exam_date: targetExamDate || null,
          username: username.trim(),
          email: email.trim(),
        }),
      });
      const data = (await res.json()) as { user?: MeUser; error?: string };
      if (!res.ok || !data.user) {
        toast.error(data.error ?? "Could not save changes.");
        return;
      }
      hydrate(data.user);
      try {
        localStorage.setItem(USERNAME_KEY, data.user.username);
      } catch {
        /* ignore */
      }
      toast.success("Profile updated.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSavingInfo(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Could not change password.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* clear local state regardless */
    }
    try {
      localStorage.removeItem(ACCOUNT_KEY);
      localStorage.removeItem(USERNAME_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(DIAG_DONE_KEY);
    } catch {
      /* ignore */
    }
    router.push("/");
  };

  const headerName = me?.display_name?.trim() || me?.username || "Your account";
  const initial = (headerName || "?").charAt(0).toUpperCase();
  const memberSince = formatMemberSince(me?.created_at);

  // Inline password-validation hints (live, non-blocking — submit guard stays).
  const pwLongEnough = newPassword.length >= 8;
  const pwMatches = confirmPassword.length > 0 && newPassword === confirmPassword;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LoderaLogo size={28} withWordmark />
            <span className="text-neutral-300 text-sm">|</span>
            <h1 className="text-sm font-semibold text-neutral-800">Account</h1>
          </div>
          <Link
            href="/"
            className="text-xs font-medium text-neutral-600 hover:text-brand-600 transition-colors px-2 py-1"
          >
            Home
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Account header card */}
        <Card>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xl font-semibold">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-neutral-900">{headerName}</p>
              <p className="truncate text-sm text-neutral-500">{me?.email ?? ""}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {memberSince && (
                  <span className="text-xs text-neutral-400">Member since {memberSince}</span>
                )}
                <Badge variant="brand">{streak} day streak</Badge>
              </div>
            </div>
          </div>
        </Card>

        {/* Personal information */}
        <Card>
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-neutral-900">Personal information</h2>
            <p className="text-xs text-neutral-500">Update how your account appears.</p>
          </div>
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pf-first" className={labelClass}>
                  First name
                </label>
                <input
                  id="pf-first"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputClass}
                  placeholder="First name"
                />
              </div>
              <div>
                <label htmlFor="pf-last" className={labelClass}>
                  Last name
                </label>
                <input
                  id="pf-last"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputClass}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div>
              <label htmlFor="pf-display" className={labelClass}>
                Display name
              </label>
              <input
                id="pf-display"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
                placeholder="How you'd like to be shown"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pf-grade" className={labelClass}>
                  Grade level
                </label>
                <input
                  id="pf-grade"
                  type="text"
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(e.target.value)}
                  className={inputClass}
                  placeholder="e.g. Sophomore, College"
                />
              </div>
              <div>
                <label htmlFor="pf-exam" className={labelClass}>
                  Target exam date
                </label>
                <input
                  id="pf-exam"
                  type="date"
                  value={targetExamDate}
                  onChange={(e) => setTargetExamDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pf-username" className={labelClass}>
                  Username
                </label>
                <input
                  id="pf-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputClass}
                  placeholder="your_username"
                />
              </div>
              <div>
                <label htmlFor="pf-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="pf-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" variant="primary" loading={savingInfo} disabled={loadingMe}>
                Save changes
              </Button>
            </div>
          </form>
        </Card>

        {/* Security */}
        <Card>
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-neutral-900">Security</h2>
            <p className="text-xs text-neutral-500">Change your password.</p>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label htmlFor="pf-curpw" className={labelClass}>
                Current password
              </label>
              <input
                id="pf-curpw"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
                placeholder="Current password"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pf-newpw" className={labelClass}>
                  New password
                </label>
                <input
                  id="pf-newpw"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputClass}
                  placeholder="At least 8 characters"
                />
                <p
                  className={cn(
                    "mt-1 text-xs",
                    newPassword.length === 0
                      ? "text-neutral-500"
                      : pwLongEnough
                        ? "text-success-600"
                        : "text-error-600"
                  )}
                >
                  {pwLongEnough ? "✓ " : ""}At least 8 characters
                </p>
              </div>
              <div>
                <label htmlFor="pf-confpw" className={labelClass}>
                  Confirm new password
                </label>
                <input
                  id="pf-confpw"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Re-enter new password"
                />
                <p
                  className={cn(
                    "mt-1 text-xs",
                    confirmPassword.length === 0
                      ? "text-neutral-500"
                      : pwMatches
                        ? "text-success-600"
                        : "text-error-600"
                  )}
                >
                  {pwMatches ? "✓ " : ""}Passwords match
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button type="submit" variant="primary" loading={savingPassword}>
                Update password
              </Button>
            </div>
          </form>
        </Card>

        {/* Subscription (stub) */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">Subscription</h2>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="success">Free plan</Badge>
                <span className="text-xs text-neutral-500">All core practice included.</span>
              </div>
            </div>
            <Button variant="secondary" disabled>
              Manage subscription (coming soon)
            </Button>
          </div>
        </Card>

        {/* Log out */}
        <div className="flex justify-center pt-2 pb-8">
          <Button variant="ghost" onClick={handleLogout} loading={loggingOut}>
            Log out
          </Button>
        </div>
      </main>
    </div>
  );
}
