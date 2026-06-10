"use client";

import { useState } from "react";

export interface KeywordStrength {
  id: string;
  label: string;
  strength: number; // 0–1
  parentLabel?: string; // umbrella label for topic keywords
}

export interface StudentStrengths {
  topic: KeywordStrength[];
  action: KeywordStrength[];
  representation: KeywordStrength[];
  prereq: KeywordStrength[];
}

interface FeedbackReportProps {
  strengths: StudentStrengths;
  answeredCount?: number;
  mode?: "compact" | "full";
}

function strengthColor(s: number): string {
  if (s < 0.35) return "#ef4444";
  if (s < 0.55) return "#f97316";
  if (s < 0.7) return "#eab308";
  if (s < 0.85) return "#84cc16";
  return "#22c55e";
}

function strengthLabel(s: number): string {
  if (s < 0.35) return "Weak";
  if (s < 0.55) return "Developing";
  if (s < 0.7) return "Progressing";
  if (s < 0.85) return "Strong";
  return "Mastered";
}

function avg(items: KeywordStrength[]): number {
  if (items.length === 0) return 0.5;
  return items.reduce((s, k) => s + k.strength, 0) / items.length;
}

function ScoreRow({ label, score, sub, indent }: { label: string; score: number; sub?: string; indent?: boolean }) {
  const color = strengthColor(score);
  const pct = Math.round(score * 100);
  return (
    <div className={indent ? "pl-4 border-l-2 border-gray-100 space-y-1" : "space-y-1"}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-gray-800 truncate block">{label}</span>
          {sub && <span className="text-[10px] text-gray-400 truncate block">{sub}</span>}
        </div>
        <span className="text-xs tabular-nums shrink-0 font-medium" style={{ color }}>
          {strengthLabel(score)}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ── Umbrella-grouped topic section ────────────────────────────────────────────
// Shows each umbrella keyword's avg score as the primary row.
// Clicking an umbrella expands a dropdown with individual in-depth skill scores.
function TopicSection({ items }: { items: KeywordStrength[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (items.length === 0) return null;

  // Group by parentLabel (umbrella). Keywords with no parentLabel go in "Other".
  const groups = new Map<string, KeywordStrength[]>();
  for (const kw of items) {
    const key = kw.parentLabel ?? "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(kw);
  }

  // Sort groups weakest-first so focus areas surface at top
  const sorted = [...groups.entries()].sort(([, a], [, b]) => avg(a) - avg(b));
  const overallAvg = avg(items);

  function toggle(umbrella: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(umbrella)) next.delete(umbrella);
      else next.add(umbrella);
      return next;
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Topic skills</h3>
        <span className="text-xs tabular-nums font-semibold" style={{ color: strengthColor(overallAvg) }}>
          {Math.round(overallAvg * 100)}%
        </span>
      </div>

      {/* Umbrella rows */}
      <div className="divide-y divide-gray-50">
        {sorted.map(([umbrella, kws]) => {
          const umbrellaAvg = avg(kws);
          const isOpen = expanded.has(umbrella);
          const sortedKws = [...kws].sort((a, b) => a.strength - b.strength);

          return (
            <div key={umbrella}>
              {/* Umbrella header — click to expand */}
              <button
                onClick={() => toggle(umbrella)}
                className="w-full px-4 py-3 text-left hover:bg-gray-50/80 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex-1 text-sm text-gray-800 font-medium truncate">{umbrella}</span>
                  <span
                    className="text-gray-400 text-sm flex-shrink-0 transition-transform duration-200"
                    style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none" }}
                  >
                    ›
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.round(umbrellaAvg * 100)}%`, backgroundColor: strengthColor(umbrellaAvg) }}
                    />
                  </div>
                  <span
                    className="text-xs tabular-nums font-medium flex-shrink-0 w-20 text-right"
                    style={{ color: strengthColor(umbrellaAvg) }}
                  >
                    {strengthLabel(umbrellaAvg)}
                  </span>
                </div>
              </button>

              {/* Individual skills — shown when expanded */}
              {isOpen && (
                <div className="px-4 pb-3 pt-1 bg-gray-50/40 border-t border-gray-50 space-y-3">
                  {sortedKws.map((kw) => (
                    <ScoreRow key={kw.id} label={kw.label} score={kw.strength} indent />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Flat section (action / representation / prereq) ───────────────────────────
function Section({ title, items }: { title: string; items: KeywordStrength[] }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.strength - b.strength);
  const avgS = avg(items);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h3>
        <span className="text-xs tabular-nums font-semibold" style={{ color: strengthColor(avgS) }}>
          {Math.round(avgS * 100)}%
        </span>
      </div>
      <div className="space-y-2.5">
        {sorted.map((kw) => (
          <ScoreRow key={kw.id} label={kw.label} score={kw.strength} />
        ))}
      </div>
    </div>
  );
}

function compactMessage(strengths: StudentStrengths, answeredCount: number): string | null {
  if (answeredCount < 5) return null;
  const allTopic = [...strengths.topic].sort((a, b) => a.strength - b.strength);
  const weakTopic = allTopic.filter((k) => k.strength < 0.5);
  const weakAction = [...strengths.action]
    .filter((k) => k.strength < 0.5)
    .sort((a, b) => a.strength - b.strength);

  const parts: string[] = [];
  if (weakTopic.length > 0)
    parts.push(`topic: ${weakTopic.slice(0, 2).map((k) => k.label).join(", ")}`);
  if (weakAction.length > 0 && answeredCount >= 10)
    parts.push(`action: ${weakAction[0]!.label}`);
  if (parts.length === 0) return "Strong performance across all tracked skills.";
  return `Focus areas — ${parts.join(" · ")}`;
}

export function FeedbackReport({
  strengths,
  answeredCount = 0,
  mode = "full",
}: FeedbackReportProps) {
  if (mode === "compact") {
    const msg = compactMessage(strengths, answeredCount);
    if (!msg) return null;
    return (
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-900">
        <span className="font-semibold">Insight: </span>
        {msg}
      </div>
    );
  }

  const allItems = [
    ...strengths.topic,
    ...strengths.action,
    ...strengths.representation,
    ...strengths.prereq,
  ];
  const overall = avg(allItems);

  return (
    <div className="space-y-4">
      {/* Overall bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-800">Overall mastery</span>
          <span
            className="text-xl font-bold tabular-nums"
            style={{ color: strengthColor(overall) }}
          >
            {Math.round(overall * 100)}%
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.round(overall * 100)}%`,
              backgroundColor: strengthColor(overall),
            }}
          />
        </div>
      </div>

      {/* Topic skills grouped by umbrella */}
      <TopicSection items={strengths.topic} />

      {/* Other dimensions — flat lists */}
      <Section title="Action skills" items={strengths.action} />
      <Section title="Representation" items={strengths.representation} />
      <Section title="Prerequisites" items={strengths.prereq} />
    </div>
  );
}
