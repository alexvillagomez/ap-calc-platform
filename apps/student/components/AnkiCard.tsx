"use client";

import { useState, useRef, useEffect } from "react";

interface McqData {
  question: string;
  choices: string[];
  correct_index: number;
  explanation: string;
}

interface AnkiCardProps {
  cardId: string;
  frontHtml: string;
  backHtml: string;
  css: string;
  mcq?: McqData | null;
  learnMore?: string | null;
  onAnswer: (correct: boolean, mode: "flip" | "mcq") => void;
}

// Build iframe srcdoc with isolated CSS + optional KaTeX
function buildSrcdoc(html: string, css: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body, {delimiters:[{left:'\\\\(',right:'\\\\)',display:false},{left:'\\\\[',right:'\\\\]',display:true},{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]})"></script>
<style>
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { padding: 28px 32px; font-size: 18px; line-height: 1.65; word-wrap: break-word; color: inherit; }
  .cloze { color: #2563eb; font-weight: bold; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  p { margin: 0 0 0.75em; }
  p:last-child { margin-bottom: 0; }
  ${css}
</style>
</head>
<body>${html}</body>
</html>`;
}

export function AnkiCard({ cardId, frontHtml, backHtml, css, mcq, learnMore, onAnswer }: AnkiCardProps) {
  const [phase, setPhase] = useState<"front" | "back" | "mcq-active" | "mcq-done" | "learn-more">("front");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const frontRef = useRef<HTMLIFrameElement>(null);
  const backRef = useRef<HTMLIFrameElement>(null);
  const [frontHeight, setFrontHeight] = useState(120);
  const [backHeight, setBackHeight] = useState(120);

  // Auto-resize iframes to content
  useEffect(() => {
    const resize = (iframe: HTMLIFrameElement | null, setter: (h: number) => void) => {
      if (!iframe) return;
      const onLoad = () => {
        const h = iframe.contentDocument?.body?.scrollHeight ?? 120;
        setter(Math.max(80, h + 32));
      };
      iframe.addEventListener("load", onLoad);
      return () => iframe.removeEventListener("load", onLoad);
    };
    const c1 = resize(frontRef.current, setFrontHeight);
    const c2 = resize(backRef.current, setBackHeight);
    return () => { c1?.(); c2?.(); };
  }, [cardId]);

  const handleFlipCorrect = (correct: boolean) => {
    onAnswer(correct, "flip");
    setPhase("front");
    setSelectedChoice(null);
  };

  const handleChoiceSelect = (idx: number) => {
    if (phase !== "mcq-active") return;
    setSelectedChoice(idx);
    setPhase("mcq-done");
  };

  const handleMcqConfirm = () => {
    if (selectedChoice === null || !mcq) return;
    const correct = selectedChoice === mcq.correct_index;
    onAnswer(correct, "mcq");
    setPhase("front");
    setSelectedChoice(null);
  };

  const showLearnMore = () => setPhase("learn-more");
  const dismissLearnMore = () => { setPhase("front"); setSelectedChoice(null); };

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Card face(s) */}
      {phase === "front" && (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-md">
            <iframe
              ref={frontRef}
              srcDoc={buildSrcdoc(frontHtml, css)}
              sandbox="allow-scripts"
              style={{ width: "100%", height: frontHeight, border: "none", display: "block" }}
              title="card-front"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setPhase("back")}
              className="flex-1 py-4 rounded-xl bg-gray-900 text-white text-base font-semibold hover:bg-gray-700 transition-colors"
            >
              Show Answer
            </button>
            {mcq && (
              <button
                onClick={() => setPhase("mcq-active")}
                className="flex-1 py-4 rounded-xl border border-gray-300 text-base font-semibold hover:bg-gray-50 transition-colors"
              >
                Quiz Me
              </button>
            )}
          </div>
        </>
      )}

      {phase === "back" && (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-md opacity-70">
            <iframe
              ref={frontRef}
              srcDoc={buildSrcdoc(frontHtml, css)}
              sandbox="allow-scripts"
              style={{ width: "100%", height: frontHeight, border: "none", display: "block" }}
              title="card-front-dim"
            />
          </div>
          <div className="rounded-2xl border-2 border-blue-300 bg-white overflow-hidden shadow-md">
            <iframe
              ref={backRef}
              srcDoc={buildSrcdoc(backHtml, css)}
              sandbox="allow-scripts"
              style={{ width: "100%", height: backHeight, border: "none", display: "block" }}
              title="card-back"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => handleFlipCorrect(false)}
              className="flex-1 py-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-base font-semibold hover:bg-red-100 transition-colors"
            >
              Missed it
            </button>
            <button
              onClick={() => handleFlipCorrect(true)}
              className="flex-1 py-4 rounded-xl bg-green-50 border border-green-200 text-green-700 text-base font-semibold hover:bg-green-100 transition-colors"
            >
              Got it
            </button>
          </div>
          {learnMore && (
            <button
              onClick={showLearnMore}
              className="text-xs text-blue-600 underline text-center"
            >
              Learn more about this concept →
            </button>
          )}
        </>
      )}

      {(phase === "mcq-active" || phase === "mcq-done") && mcq && (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-md">
            <p className="text-base font-semibold text-gray-800 mb-4">{mcq.question}</p>
            <div className="flex flex-col gap-2.5">
              {mcq.choices.map((choice, i) => {
                let cls = "text-left px-4 py-3 rounded-xl border text-base transition-colors ";
                if (phase === "mcq-done") {
                  if (i === mcq.correct_index) cls += "border-green-500 bg-green-50 text-green-800 font-medium";
                  else if (i === selectedChoice) cls += "border-red-400 bg-red-50 text-red-700";
                  else cls += "border-gray-200 text-gray-400";
                } else {
                  cls += selectedChoice === i
                    ? "border-blue-500 bg-blue-50 text-blue-800"
                    : "border-gray-200 hover:border-gray-400 hover:bg-gray-50";
                }
                return (
                  <button key={i} className={cls} onClick={() => handleChoiceSelect(i)}>
                    <span className="font-mono mr-2 text-gray-400">{String.fromCharCode(65 + i)}.</span>
                    {choice}
                  </button>
                );
              })}
            </div>
          </div>

          {phase === "mcq-done" && (
            <>
              {mcq.explanation && (
                <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                  {mcq.explanation}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleMcqConfirm}
                  className="flex-1 py-4 rounded-xl bg-gray-900 text-white text-base font-semibold hover:bg-gray-700 transition-colors"
                >
                  Next card →
                </button>
                {learnMore && (
                  <button
                    onClick={showLearnMore}
                    className="py-2.5 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 transition-colors"
                  >
                    Learn more
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {phase === "learn-more" && learnMore && (
        <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Learn More</span>
            <button onClick={dismissLearnMore} className="text-gray-400 hover:text-gray-600 text-sm">✕ Close</button>
          </div>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{learnMore}</div>
        </div>
      )}
    </div>
  );
}
