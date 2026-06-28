"use client";

/**
 * /reset-password — landing page for the Supabase recovery email link.
 *
 * The recovery link lands here and Supabase's detectSessionInUrl picks up the
 * recovery session from the URL automatically. We listen for the
 * PASSWORD_RECOVERY auth event, then call supabase.auth.updateUser({ password })
 * to set the new password on the now-authenticated recovery session.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

const inputClass = cn(
  "w-full px-3 py-2 text-sm rounded-xl border border-neutral-200",
  "focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent",
  "transition-colors placeholder:text-neutral-300"
);

export default function ResetPasswordPage() {
  const router = useRouter();

  const [ready, setReady] = useState(false); // recovery session established
  const [checked, setChecked] = useState(false); // finished resolving the session
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Let Supabase pick up the recovery session from the URL (detectSessionInUrl
  // is on by default) and listen for the PASSWORD_RECOVERY event.
  useEffect(() => {
    const supabase = supabaseBrowser();

    // Surface any error returned in the URL hash (expired/invalid link).
    try {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      if (params.get("error_description")) {
        setError(decodeURIComponent(params.get("error_description")!.replace(/\+/g, " ")));
      }
    } catch {
      /* ignore */
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
        setChecked(true);
      }
    });

    // Fallback: if a session is already present (event fired before listener),
    // resolve directly, then mark "checked" so the invalid-link state can show.
    supabase.auth.getSession().then((res: { data: { session: unknown } }) => {
      if (res.data.session) setReady(true);
      setChecked(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const pwLongEnough = password.length >= 8;
  const pwMatches = confirm.length > 0 && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    if (!pwLongEnough) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!pwMatches) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const supabase = supabaseBrowser();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message ?? "Could not reset your password. Please request a new link.");
        return;
      }
      setDone(true);
      toast.success("Password updated. You can now log in.");
      setTimeout(() => router.push("/login"), 1600);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center px-4 py-16 animate-fade-in">
      <div className="mb-8 flex flex-col items-center gap-3">
        <LoderaLogo size={44} withWordmark />
        <p className="text-sm text-neutral-500 text-center max-w-xs leading-relaxed">Set a new password</p>
      </div>

      <Card className="w-full max-w-sm">
        {/* Still resolving the token */}
        {!checked && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* No / bad recovery session */}
        {checked && !ready && !done && (
          <div className="text-center space-y-4 py-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-error-50 text-error-600 text-2xl">
              ⚠️
            </div>
            <div className="space-y-1.5">
              <h1 className="text-base font-semibold text-neutral-900">Link invalid or expired</h1>
              <p className="text-sm text-neutral-500 leading-relaxed">
                {error ?? "This password-reset link is no longer valid. Request a fresh one to continue."}
              </p>
            </div>
            <Link href="/forgot-password">
              <Button variant="primary" className="w-full">
                Request a new link
              </Button>
            </Link>
            <Link href="/login" className="block text-sm font-semibold text-brand-600 hover:text-brand-700">
              Back to log in
            </Link>
          </div>
        )}

        {/* Success */}
        {done && (
          <div className="text-center space-y-3 py-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-success-600 text-2xl">
              ✓
            </div>
            <h1 className="text-base font-semibold text-neutral-900">Password updated</h1>
            <p className="text-sm text-neutral-500">Redirecting you to log in…</p>
          </div>
        )}

        {/* Reset form */}
        {checked && ready && !done && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="rp-new" className="block text-xs font-medium text-neutral-700 mb-1">
                New password
              </label>
              <input
                id="rp-new"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="At least 8 characters"
              />
              <p
                className={cn(
                  "mt-1 text-xs",
                  password.length === 0 ? "text-neutral-500" : pwLongEnough ? "text-success-600" : "text-error-600"
                )}
              >
                {pwLongEnough ? "✓ " : ""}At least 8 characters
              </p>
            </div>

            <div>
              <label htmlFor="rp-confirm" className="block text-xs font-medium text-neutral-700 mb-1">
                Confirm new password
              </label>
              <input
                id="rp-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
                placeholder="Re-enter new password"
              />
              <p
                className={cn(
                  "mt-1 text-xs",
                  confirm.length === 0 ? "text-neutral-500" : pwMatches ? "text-success-600" : "text-error-600"
                )}
              >
                {pwMatches ? "✓ " : ""}Passwords match
              </p>
            </div>

            {error && (
              <p className="text-xs text-error-600 bg-error-50 border border-error-100 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              disabled={!pwLongEnough || !pwMatches}
              className="w-full"
            >
              Update password
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
