"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import katex from "katex";
import { cn } from "@/lib/cn";

// ─── Mini sample question (self-contained, no API) ───────────────────────────

const SAMPLE_QUESTION = {
  latex: "Which of the following correctly classifies the polynomial $f(x) = 4x^3 - 7x + 2$?",
  choices: [
    { latex: "Degree 3, leading coefficient $4$", correct: true },
    { latex: "Degree 3, leading coefficient $-7$", correct: false },
    { latex: "Degree 2, leading coefficient $4$", correct: false },
    { latex: "Degree 4, leading coefficient $2$", correct: false },
  ],
  explanation:
    "The highest-power term is $4x^3$, so the **degree is 3** and the **leading coefficient is 4**. The other terms ($-7x + 2$) don't affect either property.",
};

// ─── Tiny KaTeX render helper ─────────────────────────────────────────────────

function renderKatex(src: string, display = false): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false });
  } catch {
    return src;
  }
}

/** Render a string that may contain $…$ and $$…$$ mixed with plain text. */
function MixedMath({ content, className }: { content: string; className?: string }) {
  const parts: Array<{ type: "text" | "inline" | "display"; value: string }> = [];
  let i = 0;
  const len = content.length;
  while (i < len) {
    if (content.slice(i, i + 2) === "$$") {
      const end = content.indexOf("$$", i + 2);
      if (end === -1) { parts.push({ type: "text", value: content.slice(i) }); break; }
      parts.push({ type: "display", value: content.slice(i + 2, end).trim() });
      i = end + 2; continue;
    }
    if (content[i] === "$") {
      const rest = content.slice(i + 1);
      const next = rest.indexOf("$");
      if (next === -1) { parts.push({ type: "text", value: content.slice(i) }); break; }
      parts.push({ type: "inline", value: rest.slice(0, next) });
      i += 1 + next + 1; continue;
    }
    let end = len;
    const nd = content.indexOf("$$", i), ni = content.indexOf("$", i);
    if (nd !== -1 && (ni === -1 || nd <= ni)) end = Math.min(end, nd);
    if (ni !== -1) end = Math.min(end, ni);
    const text = content.slice(i, end);
    if (text) parts.push({ type: "text", value: text });
    i = end;
  }

  return (
    <span className={className}>
      {parts.map((p, idx) => {
        if (p.type === "text") {
          // Handle **bold** markers
          const boldParts = p.value.split(/(\*\*[^*]+\*\*)/g);
          return (
            <span key={idx}>
              {boldParts.map((bp, bi) =>
                bp.startsWith("**") && bp.endsWith("**")
                  ? <strong key={bi}>{bp.slice(2, -2)}</strong>
                  : <span key={bi}>{bp}</span>
              )}
            </span>
          );
        }
        if (p.type === "inline") {
          return <span key={idx} dangerouslySetInnerHTML={{ __html: renderKatex(p.value, false) }} />;
        }
        return <div key={idx} dangerouslySetInnerHTML={{ __html: renderKatex(p.value, true) }} className="my-1" />;
      })}
    </span>
  );
}

// ─── Skill bar animation ──────────────────────────────────────────────────────

function SkillBar({ label, from, to, animate }: { label: string; from: number; to: number; animate: boolean }) {
  const [pct, setPct] = useState(from);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const duration = 900;

  useEffect(() => {
    if (!animate) { setPct(from); return; }
    startRef.current = null;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setPct(from + (to - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [animate, from, to]);

  const color =
    pct >= 70 ? "bg-emerald-500" :
    pct >= 40 ? "bg-yellow-400" :
    "bg-red-400";

  return (
    <div className="mb-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <span className="text-xs tabular-nums text-gray-500">{Math.round(pct)}%</span>
      </div>
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-none", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Step data ────────────────────────────────────────────────────────────────

const STEPS = [
  {
    id: "hero",
    badge: "AP Calc & Precalc",
    heading: "Master Calculus — the fast, adaptive way.",
    sub: "A short diagnostic finds exactly what you know. Then the system builds a personalized practice plan — bite-size lessons, spaced review, and instant mastery tracking. All in one place.",
    icon: (
      <svg viewBox="0 0 80 80" fill="none" className="w-20 h-20" aria-hidden>
        <rect width="80" height="80" rx="20" fill="#EFF6FF" />
        <path d="M20 55 Q30 25 40 40 Q50 55 60 25" stroke="#3B82F6" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        <circle cx="40" cy="40" r="4" fill="#3B82F6" />
        <circle cx="60" cy="25" r="4" fill="#10B981" />
      </svg>
    ),
    bullets: [
      { icon: "⚡", text: "Adapts to your exact level in minutes" },
      { icon: "🎯", text: "Focuses practice where it matters most" },
      { icon: "📈", text: "Tracks mastery across every skill" },
    ],
  },
  {
    id: "loop",
    badge: "How it works",
    heading: "Four steps. Continuous improvement.",
    sub: "The system learns your strengths and weaknesses automatically — so every practice session moves the needle.",
    icon: null,
    loop: true,
  },
  {
    id: "demo",
    badge: "Try it now",
    heading: "See it in action.",
    sub: "Answer a sample question and watch your skill strength update in real time.",
    icon: null,
    demo: true,
  },
  {
    id: "ready",
    badge: "You're all set",
    heading: "Ready to start?",
    sub: "Create a free account and take the 5-minute diagnostic. We'll build your personalized practice plan automatically.",
    icon: null,
    final: true,
  },
];

const LOOP_STEPS = [
  {
    num: "01",
    color: "bg-blue-500",
    light: "bg-blue-50 border-blue-100",
    text: "text-blue-600",
    title: "Adaptive Diagnostic",
    desc: "~5 minutes. A smart algorithm asks just enough questions to map your exact knowledge gaps across Polynomials and beyond.",
  },
  {
    num: "02",
    color: "bg-violet-500",
    light: "bg-violet-50 border-violet-100",
    text: "text-violet-600",
    title: "Personalized Practice",
    desc: "Problems matched to your level. 3 correct in a row on a skill → you advance. Struggling? The system catches it instantly.",
  },
  {
    num: "03",
    color: "bg-amber-500",
    light: "bg-amber-50 border-amber-100",
    text: "text-amber-600",
    title: "Bite-Size Lessons",
    desc: "Triggered automatically when you need them. Micro-step explanations with checks, not just walls of text.",
  },
  {
    num: "04",
    color: "bg-emerald-500",
    light: "bg-emerald-50 border-emerald-100",
    text: "text-emerald-600",
    title: "Progress Report",
    desc: "A live mastery map of every skill — category → umbrella → individual skill — so you always know what to study next.",
  },
];

// ─── Onboarding component ─────────────────────────────────────────────────────

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  // Demo question state
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [skillAnimated, setSkillAnimated] = useState(false);

  const totalSteps = STEPS.length;

  function navigate(nextStep: number) {
    if (transitioning) return;
    setDirection(nextStep > step ? "forward" : "back");
    setTransitioning(true);
    setTimeout(() => {
      setStep(nextStep);
      setTransitioning(false);
    }, 220);
  }

  function handleNext() {
    if (step < totalSteps - 1) navigate(step + 1);
  }

  function handleBack() {
    if (step > 0) navigate(step - 1);
  }

  function handleGetStarted() {
    router.push("/login?register=1");
  }

  function handleLogin() {
    router.push("/login");
  }

  function handleSkip() {
    router.push("/login?register=1");
  }

  function handleAnswer(idx: number) {
    if (revealed) return;
    setSelected(idx);
    setRevealed(true);
    setTimeout(() => setSkillAnimated(true), 300);
  }

  const current = STEPS[step];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-white flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-8 py-5 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5" aria-hidden>
              <path d="M4 18 Q8 8 12 13 Q16 18 20 6" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900 tracking-tight">Precalc Demo</span>
        </div>
        <button
          onClick={handleSkip}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Skip onboarding"
        >
          Skip →
        </button>
      </header>

      {/* Progress bar */}
      <div className="w-full h-0.5 bg-gray-100">
        <div
          className="h-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
        />
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div
          className={cn(
            "w-full max-w-2xl transition-all duration-200",
            transitioning
              ? direction === "forward"
                ? "opacity-0 translate-x-6"
                : "opacity-0 -translate-x-6"
              : "opacity-100 translate-x-0"
          )}
        >
          {/* Step: Hero */}
          {current.id === "hero" && (
            <HeroStep
              onNext={handleNext}
              onLogin={handleLogin}
            />
          )}

          {/* Step: Loop */}
          {current.id === "loop" && (
            <LoopStep />
          )}

          {/* Step: Demo */}
          {current.id === "demo" && (
            <DemoStep
              selected={selected}
              revealed={revealed}
              skillAnimated={skillAnimated}
              onAnswer={handleAnswer}
            />
          )}

          {/* Step: Final */}
          {current.id === "ready" && (
            <FinalStep
              onGetStarted={handleGetStarted}
              onLogin={handleLogin}
            />
          )}
        </div>
      </main>

      {/* Bottom nav */}
      <footer className="pb-10 flex flex-col items-center gap-5">
        {/* Step dots */}
        <div className="flex items-center gap-2" role="tablist" aria-label="Onboarding steps">
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
                  ? "w-6 h-2.5 bg-blue-600"
                  : i < step
                  ? "w-2.5 h-2.5 bg-blue-300"
                  : "w-2.5 h-2.5 bg-gray-200 hover:bg-gray-300"
              )}
            />
          ))}
        </div>

        {/* Back / Next buttons (hidden on hero & final which have their own CTAs) */}
        {current.id !== "hero" && current.id !== "ready" && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="px-5 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
            >
              ← Back
            </button>
            <button
              onClick={handleNext}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              {step === totalSteps - 2 ? "See the finale →" : "Next →"}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

// ─── Step sub-components ──────────────────────────────────────────────────────

function HeroStep({ onNext, onLogin }: { onNext: () => void; onLogin: () => void }) {
  return (
    <div className="text-center space-y-8">
      {/* Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-100 rounded-full text-xs font-semibold text-blue-600 uppercase tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        AP Calc &amp; Precalc
      </div>

      {/* Heading */}
      <div className="space-y-3">
        <h1 className="text-5xl font-bold text-gray-900 leading-tight tracking-tight">
          Master Calculus —<br />
          <span className="text-blue-600">the fast, adaptive way.</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-lg mx-auto leading-relaxed">
          A short diagnostic finds exactly what you know. Then a personalized practice plan — bite-size lessons, spaced review, live mastery tracking.
        </p>
      </div>

      {/* Feature pills */}
      <div className="flex flex-wrap justify-center gap-3">
        {[
          { icon: "⚡", text: "Adapts to your level in minutes" },
          { icon: "🎯", text: "Focuses where it matters most" },
          { icon: "📈", text: "Tracks mastery across every skill" },
        ].map((b) => (
          <div
            key={b.text}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-100 rounded-xl shadow-sm text-sm text-gray-700"
          >
            <span>{b.icon}</span>
            <span>{b.text}</span>
          </div>
        ))}
      </div>

      {/* Mini illustration */}
      <div className="flex justify-center">
        <div className="relative bg-white rounded-2xl border border-gray-100 shadow-lg px-8 py-6 w-80">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Your progress</div>
          <SkillBar label="Polynomial Classification" from={0} to={88} animate />
          <SkillBar label="Factoring Techniques" from={0} to={62} animate />
          <SkillBar label="Limits & Continuity" from={0} to={41} animate />
          <div className="absolute -top-2 -right-2 bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
            Live
          </div>
        </div>
      </div>

      {/* CTAs */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <button
          onClick={onNext}
          className="px-10 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors shadow-md text-base"
        >
          See how it works →
        </button>
        <button
          onClick={onLogin}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          I already have an account — Log in
        </button>
      </div>
    </div>
  );
}

function LoopStep() {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-violet-50 border border-violet-100 rounded-full text-xs font-semibold text-violet-600 uppercase tracking-wider">
          How it works
        </div>
        <h2 className="text-4xl font-bold text-gray-900 tracking-tight">Four steps. Continuous improvement.</h2>
        <p className="text-gray-500 max-w-md mx-auto">
          The system learns your strengths and weaknesses automatically — so every session moves the needle.
        </p>
      </div>

      {/* Loop cards */}
      <div className="grid grid-cols-2 gap-4">
        {LOOP_STEPS.map((ls, i) => (
          <button
            key={ls.num}
            onClick={() => setActive(active === i ? null : i)}
            className={cn(
              "text-left p-5 rounded-2xl border transition-all duration-200 cursor-pointer group",
              active === i
                ? `${ls.light} shadow-md scale-[1.01]`
                : "bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm"
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5", ls.color)}>
                {ls.num}
              </div>
              <div className="min-w-0">
                <div className={cn("font-semibold text-sm mb-1", active === i ? ls.text : "text-gray-900")}>
                  {ls.title}
                </div>
                <p className={cn(
                  "text-xs leading-relaxed transition-all duration-200 overflow-hidden",
                  active === i ? "text-gray-600 max-h-24 opacity-100" : "text-gray-400 max-h-0 opacity-0"
                )}>
                  {ls.desc}
                </p>
                {active !== i && (
                  <p className="text-xs text-gray-400 line-clamp-1">{ls.desc.slice(0, 50)}…</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-gray-400">Click any card to expand</p>
    </div>
  );
}

function DemoStep({
  selected,
  revealed,
  skillAnimated,
  onAnswer,
}: {
  selected: number | null;
  revealed: boolean;
  skillAnimated: boolean;
  onAnswer: (i: number) => void;
}) {
  const LABELS = ["A", "B", "C", "D"];
  const correctIdx = SAMPLE_QUESTION.choices.findIndex((c) => c.correct);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-100 rounded-full text-xs font-semibold text-amber-600 uppercase tracking-wider">
          Try it now
        </div>
        <h2 className="text-4xl font-bold text-gray-900 tracking-tight">See it in action.</h2>
        <p className="text-gray-500 max-w-md mx-auto">
          Answer the question below and watch your skill strength update in real time.
        </p>
      </div>

      <div className="grid grid-cols-5 gap-6 items-start">
        {/* Question card */}
        <div className="col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
          {/* Question */}
          <div className="ap-calc-preview text-[15px] leading-relaxed text-gray-800" style={{ fontFamily: "KaTeX_Main, 'Times New Roman', serif" }}>
            <MixedMath content={SAMPLE_QUESTION.latex} />
          </div>

          {/* Choices */}
          <div className="space-y-2.5">
            {SAMPLE_QUESTION.choices.map((choice, i) => {
              const isSelected = selected === i;
              const isCorrect = choice.correct;
              let style = "border-gray-100 bg-gray-50 hover:bg-gray-100 hover:border-gray-200 text-gray-800";
              if (revealed && isCorrect) style = "border-emerald-400 bg-emerald-50 text-emerald-800";
              else if (revealed && isSelected && !isCorrect) style = "border-red-300 bg-red-50 text-red-800";

              return (
                <button
                  key={i}
                  onClick={() => onAnswer(i)}
                  disabled={revealed}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-150 text-left",
                    style,
                    !revealed && "cursor-pointer"
                  )}
                >
                  <span className={cn(
                    "w-6 h-6 shrink-0 rounded-full border text-xs flex items-center justify-center font-bold transition-colors",
                    revealed && isCorrect ? "border-emerald-500 bg-emerald-500 text-white" :
                    revealed && isSelected ? "border-red-400 bg-red-400 text-white" :
                    "border-gray-300 text-gray-500"
                  )}>
                    {LABELS[i]}
                  </span>
                  <span className="ap-calc-preview text-sm" style={{ fontFamily: "KaTeX_Main, 'Times New Roman', serif" }}>
                    <MixedMath content={choice.latex} />
                  </span>
                  {revealed && isCorrect && (
                    <span className="ml-auto text-emerald-600 text-base leading-none">✓</span>
                  )}
                  {revealed && isSelected && !isCorrect && (
                    <span className="ml-auto text-red-500 text-base leading-none">✗</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {revealed && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-800 leading-relaxed ap-calc-preview" style={{ fontFamily: "KaTeX_Main, 'Times New Roman', serif" }}>
              <div className="font-semibold text-blue-700 mb-1 text-xs uppercase tracking-wide">Explanation</div>
              <MixedMath content={SAMPLE_QUESTION.explanation} />
            </div>
          )}
        </div>

        {/* Skill bars side panel */}
        <div className="col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Skill Mastery</div>
            <SkillBar
              label="Polynomial Classification"
              from={32}
              to={skillAnimated ? (selected === correctIdx ? 71 : 20) : 32}
              animate={skillAnimated}
            />
            <SkillBar
              label="Degree & Leading Term"
              from={28}
              to={skillAnimated ? (selected === correctIdx ? 67 : 18) : 28}
              animate={skillAnimated}
            />
            <SkillBar
              label="Vocabulary"
              from={45}
              to={skillAnimated ? (selected === correctIdx ? 60 : 38) : 45}
              animate={skillAnimated}
            />
            {!revealed && (
              <p className="text-xs text-gray-400 mt-3 text-center">Answer to see your strength update →</p>
            )}
            {revealed && (
              <div className={cn(
                "mt-3 text-xs font-medium text-center px-3 py-2 rounded-lg",
                selected === correctIdx ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              )}>
                {selected === correctIdx
                  ? "Strength increased!"
                  : "Adjusted down slightly — practice focuses here next."}
              </div>
            )}
          </div>

          {revealed && (
            <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3 text-xs text-violet-700 leading-relaxed">
              <div className="font-semibold mb-1">What happens next in the real app:</div>
              <ul className="space-y-1 list-disc list-inside text-violet-600">
                <li>Score is saved to your profile</li>
                <li>Practice queue is reordered by need</li>
                {selected !== correctIdx && <li>A micro-lesson is queued for this skill</li>}
                {selected === correctIdx && <li>3 correct in a row → skill is mastered</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FinalStep({ onGetStarted, onLogin }: { onGetStarted: () => void; onLogin: () => void }) {
  return (
    <div className="text-center space-y-8">
      {/* Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full text-xs font-semibold text-emerald-600 uppercase tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Free to start
      </div>

      <div className="space-y-3">
        <h2 className="text-5xl font-bold text-gray-900 tracking-tight">
          Ready to start?
        </h2>
        <p className="text-lg text-gray-500 max-w-md mx-auto leading-relaxed">
          Create a free account and take the 5-minute diagnostic. We&apos;ll build your personalized practice plan automatically.
        </p>
      </div>

      {/* Summary cards */}
      <div className="flex justify-center gap-4 flex-wrap">
        {[
          { icon: "🕐", label: "~5 min diagnostic", desc: "One time setup" },
          { icon: "📚", label: "Polynomials first", desc: "AP Calc & Precalc" },
          { icon: "🔄", label: "Adapts every session", desc: "No static curriculum" },
        ].map((c) => (
          <div key={c.label} className="flex flex-col items-center gap-1.5 bg-white border border-gray-100 rounded-2xl shadow-sm px-6 py-4 min-w-[130px]">
            <span className="text-2xl">{c.icon}</span>
            <span className="text-sm font-semibold text-gray-800">{c.label}</span>
            <span className="text-xs text-gray-400">{c.desc}</span>
          </div>
        ))}
      </div>

      {/* CTAs */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <button
          onClick={onGetStarted}
          className="px-12 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors shadow-md text-base tracking-wide"
        >
          Create free account →
        </button>
        <button
          onClick={onLogin}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          I already have an account — Log in
        </button>
      </div>

      <p className="text-xs text-gray-300 pt-2">No credit card required. No spam.</p>
    </div>
  );
}
