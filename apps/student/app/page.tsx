"use client";

/**
 * Lodera landing — entry point for all users.
 *
 * Flow:
 *  1. Already authenticated + visited → goes directly to last center
 *     (localStorage "lodera_last_center" = "math" | "mcat").
 *  2. Onboarding already seen → skip to subject selector.
 *  3. First visit → 3-step onboarding → subject selector.
 *  4. Subject choice → /math or /mcat (login gate lives at those pages).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

const ONBOARDING_KEY  = "lodera_onboarding_done";
const LAST_CENTER_KEY = "lodera_last_center";

type Screen = "loading" | "onboarding" | "subject";

// ─── Onboarding steps ─────────────────────────────────────────────────────────

const STEPS = [
  {
    id: "adaptive",
    headline: "Practice that adapts to you.",
    body: "Every question refines your personal mastery map. The system knows exactly where you're strong and where to focus next.",
    visual: (
      <div className="flex flex-col gap-2.5 w-full max-w-xs mx-auto">
        {[
          { label: "Cell Biology", pct: 82, color: "bg-success-500" },
          { label: "Limits & Continuity", pct: 61, color: "bg-brand-500" },
          { label: "Acid-Base Chemistry", pct: 38, color: "bg-amber-400" },
        ].map((s) => (
          <div key={s.label}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-neutral-600 font-medium">{s.label}</span>
              <span className="text-neutral-400 tabular-nums">{s.pct}%</span>
            </div>
            <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full animate-progress-fill", s.color)}
                style={{ "--progress-pct": `${s.pct}%` } as React.CSSProperties}
              />
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "lessons",
    headline: "Bite-size lessons when you need them.",
    body: "No lecture walls. When a gap appears, a focused micro-lesson shows up — step by step — then more practice.",
    visual: (
      <div className="w-full max-w-xs mx-auto space-y-2">
        {[
          { icon: "📖", text: "Concept intro", done: true },
          { icon: "✏️", text: "Worked example", done: true },
          { icon: "✅", text: "Quick check", done: false },
        ].map((item, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-colors",
              item.done
                ? "border-success-200 bg-success-50 text-success-700"
                : "border-brand-200 bg-brand-50 text-brand-700"
            )}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.text}</span>
            {item.done && <span className="ml-auto text-success-500">✓</span>}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "streaks",
    headline: "Keep the streak alive.",
    body: "Daily practice builds habits. Your streak tracks consecutive study days — and your longest record.",
    visual: (
      <div className="flex gap-2 justify-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => {
          const done = i < 5;
          return (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold transition-colors",
                  done
                    ? "bg-brand-500 text-white shadow-brand-sm"
                    : "bg-neutral-100 text-neutral-300"
                )}
              >
                {done ? "🔥" : day}
              </div>
              <span className="text-xs text-neutral-400">{day}</span>
            </div>
          );
        })}
      </div>
    ),
  },
];

// ─── Main landing component ────────────────────────────────────────────────────

export default function LandingPage() {
  const router  = useRouter();
  const [screen, setScreen]         = useState<Screen>("loading");
  const [step, setStep]             = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [direction, setDirection]   = useState<"forward" | "back">("forward");

  useEffect(() => {
    // Check if already authenticated — if so, jump to last center
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error("unauth");
        return r.json() as Promise<{ user: { id: string } }>;
      })
      .then(() => {
        const last = localStorage.getItem(LAST_CENTER_KEY);
        if (last === "math") { router.replace("/math"); return; }
        if (last === "mcat") { router.replace("/mcat"); return; }
        // Authenticated but no last center — go to subject selector
        localStorage.setItem(ONBOARDING_KEY, "1");
        setScreen("subject");
      })
      .catch(() => {
        // Not authenticated — check onboarding
        const seen = localStorage.getItem(ONBOARDING_KEY) === "1";
        setScreen(seen ? "subject" : "onboarding");
      });
  }, [router]);

  function navigate(next: number) {
    if (transitioning) return;
    setDirection(next > step ? "forward" : "back");
    setTransitioning(true);
    setTimeout(() => {
      setStep(next);
      setTransitioning(false);
    }, 200);
  }

  function finishOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, "1");
    setDirection("forward");
    setTransitioning(true);
    setTimeout(() => {
      setScreen("subject");
      setTransitioning(false);
    }, 200);
  }

  function chooseCenter(center: "math" | "mcat") {
    localStorage.setItem(LAST_CENTER_KEY, center);
    router.push(center === "math" ? "/math" : "/mcat");
  }

  if (screen === "loading") {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-brand-50/30 to-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 max-w-2xl mx-auto w-full">
        <LoderaLogo size={28} withWordmark />
        {screen === "onboarding" && (
          <button
            onClick={finishOnboarding}
            className="text-sm text-neutral-400 hover:text-neutral-600 transition-colors"
            aria-label="Skip onboarding"
          >
            Skip →
          </button>
        )}
      </header>

      {/* Progress strip — onboarding only */}
      {screen === "onboarding" && (
        <div className="w-full h-0.5 bg-neutral-100">
          <div
            className="h-full bg-brand-500 transition-all duration-500 ease-out"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div
          className={cn(
            "w-full max-w-lg transition-all duration-200",
            transitioning
              ? direction === "forward"
                ? "opacity-0 translate-x-4"
                : "opacity-0 -translate-x-4"
              : "opacity-100 translate-x-0"
          )}
        >
          {screen === "onboarding" && (
            <OnboardingStep
              step={STEPS[step]}
              stepIndex={step}
              total={STEPS.length}
              onNext={() => {
                if (step < STEPS.length - 1) navigate(step + 1);
                else finishOnboarding();
              }}
              onBack={step > 0 ? () => navigate(step - 1) : undefined}
            />
          )}

          {screen === "subject" && (
            <SubjectSelector onChoose={chooseCenter} />
          )}
        </div>
      </main>

      {/* Step dots — onboarding only */}
      {screen === "onboarding" && (
        <footer className="pb-10 flex justify-center gap-2" role="tablist" aria-label="Onboarding steps">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1}`}
              onClick={() => navigate(i)}
              className={cn(
                "rounded-full transition-all duration-300",
                i === step
                  ? "w-6 h-2 bg-brand-500"
                  : i < step
                  ? "w-2 h-2 bg-brand-300"
                  : "w-2 h-2 bg-neutral-200 hover:bg-neutral-300"
              )}
            />
          ))}
        </footer>
      )}
    </div>
  );
}

// ─── Onboarding step ──────────────────────────────────────────────────────────

interface Step {
  id: string;
  headline: string;
  body: string;
  visual: React.ReactNode;
}

function OnboardingStep({
  step,
  stepIndex,
  total,
  onNext,
  onBack,
}: {
  step: Step;
  stepIndex: number;
  total: number;
  onNext: () => void;
  onBack?: () => void;
}) {
  const isLast = stepIndex === total - 1;

  return (
    <div className="text-center space-y-8">
      {/* Visual */}
      <div className="py-6">
        {step.visual}
      </div>

      {/* Copy */}
      <div className="space-y-3 px-2">
        <h1 className="text-3xl font-bold text-neutral-900 leading-tight tracking-tight">
          {step.headline}
        </h1>
        <p className="text-base text-neutral-500 leading-relaxed max-w-md mx-auto">
          {step.body}
        </p>
      </div>

      {/* CTAs */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <Button variant="primary" size="lg" onClick={onNext} className="px-10">
          {isLast ? "Choose what to study →" : "Continue →"}
        </Button>
        {onBack && (
          <button
            onClick={onBack}
            className="text-sm text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Subject selector ─────────────────────────────────────────────────────────

function SubjectSelector({ onChoose }: { onChoose: (c: "math" | "mcat") => void }) {
  return (
    <div className="space-y-8 text-center">
      <div className="space-y-2">
        <LoderaLogo size={36} className="mx-auto mb-4" />
        <h2 className="text-3xl font-bold text-neutral-900 tracking-tight">
          What are you studying?
        </h2>
        <p className="text-neutral-400 text-sm">Pick one — you can always switch later.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Math card */}
        <button
          onClick={() => onChoose("math")}
          className="group text-left"
          aria-label="Study Math"
        >
          <Card
            hover
            className={cn(
              "h-full flex flex-col gap-4 transition-all duration-200 cursor-pointer",
              "group-hover:border-brand-300 group-hover:shadow-brand-md group-focus-visible:ring-2 group-focus-visible:ring-brand-400"
            )}
          >
            {/* Icon */}
            <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center text-2xl shadow-brand-xs">
              📐
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-neutral-900 text-lg">Math</h3>
                <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-100">
                  New
                </span>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Precalc foundations through AP Calc AB. Adaptive practice, spaced review, instant mastery tracking.
              </p>
            </div>

            <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
              {["Precalc", "AP Calc AB", "Adaptive"].map((t) => (
                <span
                  key={t}
                  className="text-xs text-brand-600 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded-full font-medium"
                >
                  {t}
                </span>
              ))}
            </div>
          </Card>
        </button>

        {/* MCAT card */}
        <button
          onClick={() => onChoose("mcat")}
          className="group text-left"
          aria-label="Study MCAT"
        >
          <Card
            hover
            className={cn(
              "h-full flex flex-col gap-4 transition-all duration-200 cursor-pointer",
              "group-hover:border-violet-300 group-hover:shadow-[0_4px_16px_0_rgb(124_58_237/0.12)] group-focus-visible:ring-2 group-focus-visible:ring-violet-400"
            )}
          >
            {/* Icon */}
            <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center text-2xl shadow-brand-xs">
              🧬
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-neutral-900 text-lg">MCAT</h3>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Biology, Chemistry, Physics, Psych/Soc. AI-generated questions at every yield level.
              </p>
            </div>

            <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
              {["Biology", "Chemistry", "Psych/Soc"].map((t) => (
                <span
                  key={t}
                  className="text-xs text-violet-600 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full font-medium"
                >
                  {t}
                </span>
              ))}
            </div>
          </Card>
        </button>
      </div>
    </div>
  );
}
