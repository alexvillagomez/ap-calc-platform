"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { setLastMathCourse } from "@/lib/mathSession";

function MathCourseChooserInner() {
  // Warm up — no session needed here yet
  useEffect(() => {}, []);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LoderaLogo size={28} withWordmark />
            <span className="text-neutral-300 text-sm">|</span>
            <h1 className="text-sm font-semibold text-neutral-800">Math Center</h1>
          </div>
          <div className="flex items-center gap-2">
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-neutral-900">Choose a course</h2>
          <p className="text-sm text-neutral-500">
            Both courses share the same foundations and AP Precalculus content.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Precalculus */}
          <Link
            href="/math/precalc"
            onClick={() => setLastMathCourse("precalc")}
            className="group block"
          >
            <Card
              hover
              className="h-full flex flex-col gap-3 transition-all group-hover:border-brand-300"
            >
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center shrink-0">
                  <svg
                    className="w-5 h-5 text-brand-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide">
                    Course 1
                  </p>
                  <h3 className="text-base font-bold text-neutral-900">
                    Precalculus
                  </h3>
                </div>
              </div>
              <p className="text-sm text-neutral-600 leading-relaxed flex-1">
                Foundations + AP Precalculus. Algebra, functions, polynomials,
                exponentials, trig, and vectors. 11 categories.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["Foundations", "Polynomial & Rational", "Exponential & Log", "Trigonometry"].map(
                  (t) => (
                    <span
                      key={t}
                      className="text-xs bg-brand-50 text-brand-700 border border-brand-100 rounded-full px-2 py-0.5"
                    >
                      {t}
                    </span>
                  )
                )}
              </div>
              <div className="text-sm font-semibold text-brand-600 group-hover:text-brand-700 mt-1">
                Start Precalculus
              </div>
            </Card>
          </Link>

          {/* AP Calculus AB */}
          <Link
            href="/math/calc_ab"
            onClick={() => setLastMathCourse("calc_ab")}
            className="group block"
          >
            <Card
              hover
              className="h-full flex flex-col gap-3 transition-all group-hover:border-brand-300"
            >
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center shrink-0">
                  <svg
                    className="w-5 h-5 text-brand-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide">
                    Course 2
                  </p>
                  <h3 className="text-base font-bold text-neutral-900">
                    AP Calculus AB
                  </h3>
                </div>
              </div>
              <p className="text-sm text-neutral-600 leading-relaxed flex-1">
                Precalc foundations built in. Limits, derivatives, integrals. 19
                categories total — mirrors the AP exam.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["Limits", "Derivatives", "Integration", "Precalc included"].map(
                  (t) => (
                    <span
                      key={t}
                      className="text-xs bg-brand-50 text-brand-700 border border-brand-100 rounded-full px-2 py-0.5"
                    >
                      {t}
                    </span>
                  )
                )}
              </div>
              <div className="text-sm font-semibold text-brand-600 group-hover:text-brand-700 mt-1">
                Start AP Calc AB
              </div>
            </Card>
          </Link>
        </div>

        <p className="text-xs text-neutral-400 text-center">
          Your progress saves automatically and is separate between courses.
        </p>
      </main>
    </div>
  );
}

export default function MathCenterPage() {
  return (
    <LoginGate prompt="Sign in to access the Math Center.">
      <MathCourseChooserInner />
    </LoginGate>
  );
}
