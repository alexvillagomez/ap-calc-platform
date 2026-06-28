"use client";

/**
 * /forgot-password — request a password-reset email.
 *
 * Calls Supabase Auth's resetPasswordForEmail, which sends a recovery email
 * (the link lands on /reset-password). We always show the same confirmation so
 * we never reveal which emails are registered.
 */

import { useState } from "react";
import Link from "next/link";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = supabaseBrowser();
      // Fire-and-forget: never reveal whether the email is registered.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setSent(true);
    } catch {
      // Still show the same confirmation — don't leak email existence.
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center px-4 py-16 animate-fade-in">
      <div className="mb-8 flex flex-col items-center gap-3">
        <LoderaLogo size={44} withWordmark />
        <p className="text-sm text-neutral-500 text-center max-w-xs leading-relaxed">
          Reset your password
        </p>
      </div>

      <Card className="w-full max-w-sm">
        {sent ? (
          <div className="text-center space-y-4 py-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-success-600 text-2xl">
              ✉️
            </div>
            <div className="space-y-1.5">
              <h1 className="text-base font-semibold text-neutral-900">Check your email</h1>
              <p className="text-sm text-neutral-500 leading-relaxed">
                If an account exists for <span className="font-medium text-neutral-700">{email}</span>, we&apos;ve
                sent a link to reset your password. The link expires shortly — check your spam folder if you
                don&apos;t see it.
              </p>
            </div>
            <div className="pt-2">
              <Link href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                Back to log in
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-5">
              <h1 className="text-base font-semibold text-neutral-900">Forgot your password?</h1>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                Enter your account email and we&apos;ll send you a link to set a new one.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="fp-email" className="block text-xs font-medium text-neutral-700 mb-1">
                  Email
                </label>
                <input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                />
              </div>

              {error && (
                <p className="text-xs text-error-600 bg-error-50 border border-error-100 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}

              <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
                Send reset link
              </Button>
            </form>

            <p className="mt-4 text-center text-xs text-neutral-500">
              Remembered it?{" "}
              <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
                Back to log in
              </Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
