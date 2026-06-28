"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import MathText from "@/components/mcat/MathText";
import { NavMenu } from "@/components/nav/NavMenu";
import { getOrCreateMcatSession } from "@/lib/mcatSession";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiagQuestion {
  id: string;
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  difficulty: number;
}

interface StartResponse {
  done: boolean;
  diagnostic_session_id: string;
  question_number?: number;
  total_estimated?: number;
  question?: DiagQuestion;
}

interface AnswerResponse {
  done: boolean;
  question_number?: number;
  total_estimated?: number;
  question?: DiagQuestion;
  category_estimates?: Record<string, number>;
}

type Phase =
  | "intro"
  | "loading"
  | "question"
  | "revealed"
  | "completing"
  | "done"
  | "unavailable"
  | "error";

// ─── Inner component ──────────────────────────────────────────────────────────

function McatDiagnosticInner() {
  const [sessionId, setSessionId] = useState("");
  const [phase, setPhase] = useState<Phase>("intro");
  const [errorMsg, setErrorMsg] = useState("");

  const [diagnosticId, setDiagnosticId] = useState("");
  const [questionNumber, setQuestionNumber] = useState(1);
  const [totalEstimated, setTotalEstimated] = useState(10);
  const [question, setQuestion] = useState<DiagQuestion | null>(null);

  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [dontKnow, setDontKnow] = useState(false);

  const [knownCount, setKnownCount] = useState(0);
  const [askedCount, setAskedCount] = useState(0);

  useEffect(() => {
    getOrCreateMcatSession()
      .then((sid) => setSessionId(sid))
      .catch(() => setPhase("error"));
  }, []);

  const startDiagnostic = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/mcat/diagnostic/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (res.status === 404) {
        setPhase("unavailable");
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as StartResponse;

      setDiagnosticId(data.diagnostic_session_id);
      if (data.done || !data.question) {
        setPhase("done");
        return;
      }
      setQuestionNumber(data.question_number ?? 1);
      setTotalEstimated(data.total_estimated ?? 10);
      setQuestion(data.question);
      setSelectedChoice(null);
      setDontKnow(false);
      setPhase("question");
    } catch (e) {
      const msg = (e as Error).message ?? "Failed to start diagnostic";
      if (msg.includes("404") || msg.includes("not seeded")) {
        setPhase("unavailable");
        return;
      }
      setErrorMsg(msg);
      setPhase("error");
    }
  }, [sessionId]);

  const submitAnswer = useCallback(
    async (selectedIndex: number | null, isDontKnow: boolean) => {
      if (!diagnosticId || !question) return;
      // Tally placement locally for the summary screen.
      const wasCorrect = !isDontKnow && selectedIndex === question.correct_index;
      setAskedCount((c) => c + 1);
      if (wasCorrect) setKnownCount((c) => c + 1);
      setPhase("completing");
      try {
        const res = await fetch("/api/mcat/diagnostic/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            diagnostic_session_id: diagnosticId,
            question_id: question.id,
            selected_index: selectedIndex,
            dont_know: isDontKnow,
          }),
        });
        if (res.status === 404) {
          setPhase("unavailable");
          return;
        }
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as AnswerResponse;

        if (data.done || !data.question) {
          setPhase("done");
          return;
        }
        setQuestionNumber(data.question_number ?? questionNumber + 1);
        setTotalEstimated(data.total_estimated ?? totalEstimated);
        setQuestion(data.question);
        setSelectedChoice(null);
        setDontKnow(false);
        setPhase("question");
      } catch (e) {
        const msg = (e as Error).message ?? "Failed to submit answer";
        if (msg.includes("404")) {
          setPhase("unavailable");
          return;
        }
        setErrorMsg(msg);
        setPhase("error");
      }
    },
    [diagnosticId, question, sessionId, questionNumber, totalEstimated]
  );

  const handleChoice = useCallback(
    (idx: number) => {
      if (phase !== "question" || selectedChoice !== null) return;
      setSelectedChoice(idx);
      setDontKnow(false);
      setPhase("revealed");
    },
    [phase, selectedChoice]
  );

  const handleDontKnow = useCallback(() => {
    if (phase !== "question") return;
    setSelectedChoice(null);
    setDontKnow(true);
    setPhase("revealed");
  }, [phase]);

  const handleNext = useCallback(() => {
    submitAnswer(selectedChoice, dontKnow);
  }, [submitAnswer, selectedChoice, dontKnow]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-3 flex items-center gap-3">
          <Link
            href="/mcat"
            className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0"
          >
            ← MCAT Biology
          </Link>
          <h1 className="font-semibold text-neutral-900 text-sm">
            Placement Diagnostic
          </h1>
          <NavMenu className="ml-auto" />
        </div>

        {(phase === "question" || phase === "revealed" || phase === "completing") && (
          <div className="w-full px-6 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {Array.from({ length: Math.min(totalEstimated, 12) }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-all ${
                      i < questionNumber - 1
                        ? "bg-brand-500"
                        : i === questionNumber - 1
                        ? "bg-brand-400 scale-125"
                        : "bg-neutral-200"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-neutral-400 shrink-0">
                {questionNumber} / ~{totalEstimated}
              </span>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {phase === "intro" && (
          <Card className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-neutral-900">
                Placement Diagnostic
              </h2>
              <p className="text-sm text-neutral-600 leading-relaxed">
                ~10 quick questions, one per major topic. We find where to start
                you so you can skip what you already know. No pressure — be honest.
              </p>
            </div>
            <ul className="space-y-1.5 text-sm text-neutral-600">
              {[
                "One question per major Biology topic",
                "\"I don't know\" is always an honest option",
                "Topics you nail are marked done — auto mode starts at the rest",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span className="text-brand-400 mt-0.5 shrink-0">•</span>
                  {point}
                </li>
              ))}
            </ul>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={startDiagnostic}
              disabled={!sessionId}
            >
              Start diagnostic
            </Button>
          </Card>
        )}

        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Preparing your diagnostic…</p>
          </div>
        )}

        {phase === "completing" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Analyzing your answer…</p>
          </div>
        )}

        {phase === "error" && (
          <Card className="text-center space-y-3">
            <p className="text-sm text-error-600">{errorMsg}</p>
            <Button variant="secondary" size="sm" onClick={() => setPhase("intro")}>
              Try again
            </Button>
          </Card>
        )}

        {phase === "unavailable" && (
          <Card className="text-center space-y-4">
            <p className="text-base font-semibold text-neutral-800">
              Let&apos;s skip the placement check
            </p>
            <p className="text-sm text-neutral-500">
              We couldn&apos;t set up a placement check right now — no problem. You
              can jump straight into MCAT Biology and start learning. We&apos;ll
              adapt as you go.
            </p>
            <Link href="/mcat/auto">
              <Button variant="primary" size="md">
                Start learning
              </Button>
            </Link>
            <div>
              <Link
                href="/mcat"
                className="text-xs text-neutral-400 hover:text-neutral-600"
              >
                Back to MCAT Biology
              </Link>
            </div>
          </Card>
        )}

        {(phase === "question" || phase === "revealed") && question && (
          <>
            <Card>
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{question.stem}</MathText>
              </p>
            </Card>

            <div className="space-y-2">
              {question.choices.map((choice, i) => {
                let state: "default" | "correct" | "wrong" | "dimmed" = "default";
                if (phase === "revealed") {
                  if (i === question.correct_index) state = "correct";
                  else if (!dontKnow && i === selectedChoice) state = "wrong";
                  else state = "dimmed";
                }
                return (
                  <ChoiceButton
                    key={i}
                    index={i}
                    text={choice}
                    state={state}
                    disabled={phase === "revealed"}
                    onClick={() => handleChoice(i)}
                  />
                );
              })}
            </div>

            {phase === "question" && (
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={handleDontKnow}>
                  I don&apos;t know
                </Button>
              </div>
            )}

            {phase === "revealed" && (
              <>
                {question.explanation && (
                  <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                    <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide mb-1.5">
                      Explanation
                    </p>
                    <p className="text-sm text-neutral-700 leading-relaxed">
                      <MathText>{question.explanation}</MathText>
                    </p>
                  </div>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={handleNext}
                >
                  Next
                </Button>
              </>
            )}
          </>
        )}

        {phase === "done" && (
          <div className="space-y-5">
            <Card className="space-y-4">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center mx-auto">
                  <span className="text-success-600 text-xl font-bold">✓</span>
                </div>
                <h2 className="text-base font-bold text-neutral-900">
                  {askedCount > 0 ? "Placement complete" : "Starting from the beginning"}
                </h2>
                <p className="text-sm text-neutral-500">
                  {askedCount > 0
                    ? `You showed strength on ${knownCount} of ${askedCount} topics. Auto mode will start you at the first topic you haven't mastered yet — in course order.`
                    : "Couldn't load the placement quiz right now — we'll start you at the beginning and adapt as you go."}
                </p>
              </div>
            </Card>

            <div className="space-y-2">
              <Link href="/mcat/auto">
                <Button variant="primary" size="lg" className="w-full">
                  Start learning
                </Button>
              </Link>
              <Link href="/mcat">
                <Button variant="secondary" size="md" className="w-full">
                  View all topics
                </Button>
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function McatDiagnosticPage() {
  return (
    <LoginGate prompt="Sign in to take your placement diagnostic.">
      <McatDiagnosticInner />
    </LoginGate>
  );
}
