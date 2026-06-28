"use client";

/**
 * /try — free single-question trial for unauthenticated visitors.
 *
 * Flow:
 *  1. Load a curated question from /api/math/sample-question (no auth).
 *  2. User selects an answer → see correct/incorrect feedback + solution.
 *  3. Sign-up CTA is shown — one question only, no further questions served.
 *
 * One-question cap: enforced client-side (phase never advances past "answered")
 * and server-side (the API always returns exactly one question).
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import MathText from "@/components/mcat/MathText";
import { cn } from "@/lib/cn";

interface SampleQuestion {
  id: string;
  stem_latex: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
  hint_latex: string | null;
  difficulty: number;
}

type Phase = "loading" | "question" | "answered" | "error";

function difficultyLabel(d: number): { label: string; cls: string } {
  if (d < 0.35) return { label: "Easy", cls: "bg-success-100 text-success-700" };
  if (d < 0.65) return { label: "Medium", cls: "bg-amber-100 text-amber-700" };
  return { label: "Hard", cls: "bg-error-100 text-error-700" };
}

export default function TryPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [question, setQuestion] = useState<SampleQuestion | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    fetch("/api/math/sample-question")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load question");
        return r.json() as Promise<{ question: SampleQuestion }>;
      })
      .then(({ question: q }) => {
        setQuestion(q);
        setPhase("question");
      })
      .catch((e: unknown) => {
        setErrorMsg((e as Error).message ?? "Failed to load question");
        setPhase("error");
      });
  }, []);

  function handleChoice(index: number) {
    if (phase !== "question") return;
    setSelectedIndex(index);
    setPhase("answered");
  }

  const isCorrect = selectedIndex !== null && selectedIndex === question?.correct_index;

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-brand-50/30 to-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 max-w-2xl mx-auto w-full">
        <Link href="/" aria-label="Home">
          <LoderaLogo size={28} withWordmark />
        </Link>
        <Link
          href="/login"
          className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
        >
          Log in
        </Link>
      </header>

      {/* Progress strip — single tick to signal "1 of 1 free question" */}
      <div className="w-full h-0.5 bg-neutral-100">
        <div
          className={cn(
            "h-full bg-brand-500 transition-all duration-700",
            phase === "loading" ? "w-0" : phase === "question" ? "w-1/2" : "w-full"
          )}
        />
      </div>

      <main className="flex-1 flex flex-col items-center justify-start px-4 py-8 max-w-2xl mx-auto w-full">
        {/* Eyebrow */}
        <div className="text-center mb-6">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-widest mb-1">
            Free preview
          </p>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">
            Try a real question
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            No account needed — just pick an answer.
          </p>
        </div>

        {/* ── Loading ── */}
        {phase === "loading" && (
          <div className="flex flex-col items-center py-20 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-400">Loading question…</p>
          </div>
        )}

        {/* ── Error ── */}
        {phase === "error" && (
          <div className="w-full rounded-xl border border-error-200 bg-error-50 p-6 text-center space-y-3">
            <p className="text-sm text-error-600">{errorMsg || "Something went wrong."}</p>
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        )}

        {/* ── Question ── */}
        {(phase === "question" || phase === "answered") && question && (
          <div className="w-full space-y-4">
            {/* Stem */}
            <Card className="p-5">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{question.stem_latex}</MathText>
              </p>
            </Card>

            {/* Choices */}
            <div className="space-y-2" data-testid="choice-list">
              {question.choices.map((choice, i) => {
                let state: "default" | "correct" | "wrong" | "dimmed" = "default";
                if (phase === "answered") {
                  if (i === question.correct_index) state = "correct";
                  else if (i === selectedIndex) state = "wrong";
                  else state = "dimmed";
                }
                return (
                  <ChoiceButton
                    key={i}
                    index={i}
                    text={choice}
                    state={state}
                    disabled={phase === "answered"}
                    onClick={() => handleChoice(i)}
                  />
                );
              })}
            </div>

            {/* ── Feedback + CTA (shown after answering) ── */}
            {phase === "answered" && (
              <div className="space-y-4 pt-2" data-testid="feedback-panel">
                {/* Result banner */}
                <div
                  className={cn(
                    "rounded-xl border px-5 py-4 flex items-start gap-3",
                    isCorrect
                      ? "border-success-300 bg-success-50"
                      : "border-error-300 bg-error-50"
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold mt-0.5",
                      isCorrect ? "bg-success-500 text-white" : "bg-error-500 text-white"
                    )}
                  >
                    {isCorrect ? "✓" : "✗"}
                  </span>
                  <div>
                    <p className={cn("font-semibold text-sm", isCorrect ? "text-success-800" : "text-error-800")}>
                      {isCorrect ? "Correct!" : "Not quite."}
                    </p>
                    {!isCorrect && (
                      <p className="text-xs text-neutral-600 mt-0.5">
                        The correct answer was{" "}
                        <span className="font-semibold">
                          {String.fromCharCode(65 + question.correct_index)}.{" "}
                          <MathText>{question.choices[question.correct_index]}</MathText>
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Solution */}
                {question.solution_latex && (
                  <div className="bg-brand-50 rounded-xl border border-brand-100 px-5 py-4">
                    <p className="text-xs font-semibold text-brand-700 mb-1.5">Solution</p>
                    <p className="text-sm text-neutral-700 leading-relaxed">
                      <MathText>{question.solution_latex}</MathText>
                    </p>
                  </div>
                )}

                {/* Sign-up CTA */}
                <Card
                  className="text-center py-8 px-6 space-y-4"
                  data-testid="signup-cta"
                >
                  <LoderaLogo size={32} className="mx-auto" />
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold text-neutral-900 tracking-tight">
                      Create a free account to keep going
                    </h2>
                    <p className="text-sm text-neutral-500">
                      Adaptive practice, instant mastery tracking, bite-size lessons —
                      all free.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link href="/login?mode=signup">
                      <Button variant="primary" size="lg" className="w-full sm:w-auto px-8">
                        Sign up free →
                      </Button>
                    </Link>
                    <Link href="/login">
                      <Button variant="secondary" size="lg" className="w-full sm:w-auto px-8">
                        Log in
                      </Button>
                    </Link>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
