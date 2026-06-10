"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Preview } from "@/components/Preview";
import { ContentFeedback } from "@/components/ContentFeedback";
import { cn } from "@/lib/cn";

const SESSION_KEY = "ap_calc_student_session_id";
const LABELS = ["A", "B", "C", "D"];

type Problem = {
  id: string;
  latex_content: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
  hint_latex: string | null;
  difficulty: number;
  feedback_content_type?: "rag_example" | "learn_practice_problem";
};

type Phase = "loading" | "question" | "revealed" | "tip" | "quiz_offer" | "error";

type TipData = { tip_latex: string } | null;

export default function PracticePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-sm text-gray-400">Loading…</p></div>}>
      <PracticePageInner />
    </Suspense>
  );
}

function PracticePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const keywordId = searchParams.get("keyword") ?? "product_of_powers";
  const topicId = searchParams.get("topic") ?? "exponent_rules";

  const [phase, setPhase] = useState<Phase>("loading");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [tip, setTip] = useState<TipData>(null);
  const [consecutiveWrong, setConsecutiveWrong] = useState(0);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const sessionId = typeof window !== "undefined" ? localStorage.getItem(SESSION_KEY) ?? "" : "";

  const loadNext = useCallback(async () => {
    setPhase("loading");
    setSelectedIndex(null);
    setCorrect(null);
    setTip(null);

    try {
      const res = await fetch("/api/learn/practice/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, keyword_id: keywordId, excludeIds: seenIds }),
      });
      const data = await res.json() as { problem?: Problem; error?: string };
      if (!res.ok || !data.problem) {
        setErrorMsg(data.error ?? "No problems available");
        setPhase("error");
        return;
      }
      setProblem(data.problem);
      setPhase("question");
    } catch {
      setErrorMsg("Failed to load problem");
      setPhase("error");
    }
  }, [sessionId, keywordId, seenIds]);

  useEffect(() => {
    loadNext();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAnswer(index: number) {
    if (!problem || phase !== "question") return;
    const isCorrect = index === problem.correct_index;
    setSelectedIndex(index);
    setCorrect(isCorrect);
    setSeenIds((prev) => [...prev, problem.id]);
    setPhase("revealed");

    const newConsecWrong = isCorrect ? 0 : consecutiveWrong + 1;
    const newConsecCorrect = isCorrect ? consecutiveCorrect + 1 : 0;
    setConsecutiveWrong(newConsecWrong);
    setConsecutiveCorrect(newConsecCorrect);

    // Record attempt
    try {
      const res = await fetch("/api/learn/practice/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, keyword_id: keywordId, topic_id: topicId, correct: isCorrect }),
      });
      const data = await res.json() as { show_tip?: boolean; offer_mastery_quiz?: boolean };

      if (data.offer_mastery_quiz) {
        setPhase("quiz_offer");
        return;
      }
      if (data.show_tip || newConsecWrong >= 2) {
        // Fetch tip
        const tipRes = await fetch(`/api/learn/tip/${keywordId}?sessionId=${sessionId}`);
        if (tipRes.ok) {
          const tipData = await tipRes.json() as { tip_latex: string };
          setTip(tipData);
          setPhase("tip");
        }
      }
    } catch {
      // Non-critical — continue
    }
  }

  function handleTipAction(action: "lesson" | "refresher" | "dismiss") {
    if (action === "lesson") {
      router.push(`/learn/lesson/${keywordId}`);
    } else if (action === "refresher") {
      router.push(`/learn/refresher/${keywordId}`);
    } else {
      loadNext();
    }
  }

  if (phase === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading problem…</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm text-red-600">{errorMsg}</p>
          <button onClick={() => router.push("/learn")} className="text-sm text-blue-600 underline">
            Back to learn
          </button>
        </div>
      </div>
    );
  }

  if (phase === "quiz_offer") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center space-y-4">
          <div className="text-3xl">🎯</div>
          <h2 className="text-lg font-semibold text-gray-900">Ready to prove it?</h2>
          <p className="text-sm text-gray-500">
            You&apos;ve been doing great. Take a short mastery quiz to lock in this skill.
          </p>
          <button
            onClick={() => router.push(`/learn/mastery-quiz/${keywordId}`)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors"
          >
            Take mastery quiz →
          </button>
          <button
            onClick={loadNext}
            className="w-full text-sm text-gray-400 hover:text-gray-600 underline"
          >
            Keep practicing instead
          </button>
        </div>
      </div>
    );
  }

  if (!problem) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col px-4 py-10">
      <div className="max-w-xl mx-auto w-full space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs bg-blue-100 text-blue-700 font-medium px-2 py-1 rounded-full">
              Practice
            </span>
            <span className="text-xs text-gray-400">{problem.difficulty < 0.3 ? "Easy" : problem.difficulty < 0.5 ? "Medium-Easy" : problem.difficulty < 0.7 ? "Medium" : problem.difficulty < 0.9 ? "Medium-Hard" : "Hard"}</span>
          </div>
          <div className="flex items-center gap-3">
            {consecutiveCorrect > 0 && (
              <span className="text-xs text-green-600 font-medium">🔥 {consecutiveCorrect} in a row</span>
            )}
            <button onClick={() => router.back()} className="text-xs text-gray-400 hover:text-gray-600">
              ← Back
            </button>
          </div>
        </div>

        {/* Problem */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="ap-calc-preview text-sm leading-relaxed">
            <Preview latexContent={problem.latex_content} />
          </div>

          <div className="space-y-2">
            {problem.choices.map((choice, i) => {
              const isRevealed = phase === "revealed" || phase === "tip";
              const isSelected = selectedIndex === i;
              const isCorrect = i === problem.correct_index;

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={isRevealed}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors",
                    !isRevealed && "border-gray-200 hover:border-blue-400 hover:bg-blue-50",
                    isRevealed && isCorrect && "border-green-400 bg-green-50",
                    isRevealed && isSelected && !isCorrect && "border-red-400 bg-red-50",
                    isRevealed && !isSelected && !isCorrect && "border-gray-100 bg-gray-50 opacity-60",
                    "text-sm"
                  )}
                >
                  <span className={cn(
                    "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold",
                    !isRevealed && "bg-gray-100 text-gray-600",
                    isRevealed && isCorrect && "bg-green-500 text-white",
                    isRevealed && isSelected && !isCorrect && "bg-red-500 text-white",
                    isRevealed && !isSelected && !isCorrect && "bg-gray-200 text-gray-400",
                  )}>
                    {isRevealed && isCorrect ? "✓" : isRevealed && isSelected && !isCorrect ? "✗" : LABELS[i]}
                  </span>
                  <span className="ap-calc-preview flex-1 min-w-0">
                    <Preview latexContent={choice} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Revealed: solution */}
        {(phase === "revealed" || phase === "tip") && (
          <div className={cn(
            "rounded-xl border p-4 space-y-2",
            correct ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
          )}>
            <p className={cn("text-sm font-medium", correct ? "text-green-800" : "text-red-800")}>
              {correct ? "Correct!" : "Not quite."}
            </p>
            <div className={cn("ap-calc-preview text-sm", correct ? "text-green-700" : "text-red-700")}>
              <Preview latexContent={problem.solution_latex} />
            </div>
            {!correct && problem.hint_latex && (
              <div className="ap-calc-preview text-sm text-gray-600 border-t border-red-100 pt-2">
                <Preview latexContent={problem.hint_latex} />
              </div>
            )}
          </div>
        )}

        {(phase === "revealed" || phase === "tip") && (
          <ContentFeedback
            key={problem.id}
            sessionId={sessionId}
            contentType={problem.feedback_content_type ?? (problem.id.startsWith("rag_") ? "rag_example" : "learn_practice_problem")}
            contentId={problem.id}
            label="Rate this problem"
          />
        )}

        {/* Tip popup */}
        {phase === "tip" && tip && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Tip</p>
            <div className="ap-calc-preview text-sm text-amber-900">
              <Preview latexContent={tip.tip_latex} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => handleTipAction("lesson")}
                className="text-xs bg-white border border-amber-300 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors"
              >
                Open lesson
              </button>
              <button
                onClick={() => handleTipAction("refresher")}
                className="text-xs bg-white border border-amber-300 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors"
              >
                Quick refresher
              </button>
              <button
                onClick={() => handleTipAction("dismiss")}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Next button */}
        {(phase === "revealed") && (
          <button
            onClick={loadNext}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors"
          >
            Next problem →
          </button>
        )}
      </div>
    </div>
  );
}
