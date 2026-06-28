"use client";

import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { LoderaLogo } from "@/components/brand/LoderaLogo";

const SEEN_KEY = "mcat_onboarding_seen";

const STEPS: { icon: string; title: string; body: string }[] = [
  {
    icon: "🧬",
    title: "Pick a topic, go as deep as you want",
    body: "Browse Biology by category → umbrella → specific concept. Practice a whole category or drill into a single in-depth keyword.",
  },
  {
    icon: "🃏",
    title: "Flashcards and questions adapt to you",
    body: "New topics start with a quick flashcard warm-up, then questions. Difficulty rises as you improve — or set Easy / Medium / Hard yourself.",
  },
  {
    icon: "💡",
    title: "Lessons appear when you're stuck",
    body: 'No lectures up front. If you miss a few or tap “Learn this,” a short lesson shows up. Master a topic, then spaced review keeps it fresh.',
  },
  {
    icon: "📈",
    title: "Every answer builds your mastery map",
    body: "Your progress is tracked per concept so practice always targets your weakest spots. Rate or flag anything that looks off.",
  },
];

/**
 * Quick first-visit onboarding for /mcat. Self-gates on localStorage — renders
 * nothing after the student has dismissed it once.
 */
export default function McatOnboarding() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let active = true;
    supabaseBrowser()
      .auth.getUser()
      .then((res: { data: { user: unknown } }) => {
        if (!active) return;
        if (res.data.user && !localStorage.getItem(SEEN_KEY)) setShow(true);
      })
      .catch(() => { /* ignore */ });
    return () => { active = false; };
  }, []);

  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setShow(false);
  };

  if (!show) return null;

  const isLast = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-brand-lg overflow-hidden border border-neutral-200">
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between mb-4">
            <LoderaLogo size={22} withWordmark className="opacity-80" />
            <button
              onClick={dismiss}
              className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              Skip
            </button>
          </div>

          <div className="text-3xl mt-2 mb-3">{s?.icon}</div>
          <h2 className="text-lg font-bold text-neutral-900 leading-snug">
            {s?.title}
          </h2>
          <p className="text-sm text-neutral-600 leading-relaxed mt-2 min-h-[64px]">
            {s?.body}
          </p>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mt-5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === step ? "w-5 bg-brand-500" : "w-1.5 bg-neutral-200"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 mt-6">
            {step > 0 && (
              <button
                onClick={() => setStep((n) => n - 1)}
                className="px-4 py-2.5 rounded-xl border border-neutral-200 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? dismiss() : setStep((n) => n + 1))}
              className="flex-1 px-4 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors shadow-brand-sm"
            >
              {isLast ? "Start practicing →" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
