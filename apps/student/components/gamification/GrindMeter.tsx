"use client";

/**
 * GrindMeter — a fire / "heating up" GRIND meter shown at the top of practice
 * and flashcards. It measures EFFORT / FOCUS, not correctness, and ONLY EVER
 * INCREASES (within a day) — a wrong answer NEVER drops it.
 *
 * Two modes, both backed by the persistent per-user/day store in
 * `lib/grindMeter.ts`:
 *  - mode="flashcard": every card SEEN (any outcome) adds a small boost and
 *    bumps the "X seen today" counter shown subtly in the corner.
 *  - mode="quiz": each CORRECT answer adds, multiplied by the current
 *    consecutive-correct multiplier (correct answers compound). A WRONG answer
 *    resets the multiplier to ×1 but the meter level holds steady (no drop).
 *
 * The flame ramps "Warming up → Heating up → On fire → Blazing → Inferno →
 * Supernova → Prismatic" as the day's accumulated grind grows. Low/mid tiers
 * are unchanged; the new post-Inferno tiers activate only after ~480 pts
 * (heat ≈ 0.95, effectively a "full bar"). At "Prismatic" the flame and bar
 * shimmer with a slowly cycling rainbow gradient — subtle but unmistakably
 * different from the fire tiers below.
 *
 * The component is event-driven off the `answered`/`streak` props: each
 * increment of `answered` is recorded into the store (flashcard seen, or quiz
 * correct/wrong inferred from whether `streak` rose). Prop deltas are measured
 * from mount, so a remount never double-counts already-recorded items.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  loadGrind,
  subscribeGrind,
  recordFlashcardSeen,
  recordQuizAnswer,
  heatFromLevel,
  overdriveFromLevel,
  cycleProgress,
  type GrindState,
} from "@/lib/grindMeter";

interface GrindMeterProps {
  /** "flashcard" → every seen card boosts; "quiz" → correct-streak multiplies. */
  mode: "flashcard" | "quiz";
  /** Consecutive-correct streak (quiz mode: infers correct vs wrong). */
  streak: number;
  /** Items seen/answered this session — each increment records a grind event. */
  answered?: number;
  /** Epoch ms when this session started (subtle time-on-app heat). */
  startedAt?: number;
  className?: string;
  /**
   * Record grind events but render NOTHING. Used to keep the effort feature
   * accumulating in the background on clean/minimal views (auto, practice, quiz,
   * flashcards) without showing a big progress bar up front.
   */
  hidden?: boolean;
  /**
   * Compact chip render — just the flame + a tiny tier/multiplier label, NO
   * full-width bar. For tucking a subtle streak/grind indicator into a header
   * corner (auto mode) without the dominant progress bar returning.
   */
  compact?: boolean;
}

type Tier = {
  key: string;
  label: string;
  /** null = rainbow mode (gradient computed dynamically) */
  from: string | null;
  to: string | null;
  text: string;
  glow: string | null;
  /** Whether this tier uses the animated rainbow shimmer */
  rainbow?: boolean;
};

// Heat tiers, coldest → hottest.
// The first 5 (cold → inferno) are unchanged from the original design.
// Supernova and Prismatic activate only once level exceeds OVERDRIVE_THRESHOLD.
const TIERS: Tier[] = [
  { key: "cold",      label: "Warming up", from: "#cbd5e1", to: "#94a3b8", text: "text-neutral-500",  glow: "rgba(148,163,184,0)"    },
  { key: "warm",      label: "Heating up", from: "#fcd34d", to: "#fb923c", text: "text-amber-600",    glow: "rgba(251,146,60,0.35)"  },
  { key: "hot",       label: "On fire",    from: "#fb923c", to: "#ef4444", text: "text-orange-600",   glow: "rgba(239,68,68,0.45)"   },
  { key: "blazing",   label: "Blazing",    from: "#ef4444", to: "#dc2626", text: "text-red-600",      glow: "rgba(220,38,38,0.55)"   },
  { key: "inferno",   label: "Inferno",    from: "#f87171", to: "#7c3aed", text: "text-violet-600",   glow: "rgba(124,58,237,0.6)"   },
  // Post-saturation overdrive tiers:
  { key: "supernova", label: "Supernova",  from: "#a855f7", to: "#06b6d4", text: "text-cyan-400",     glow: "rgba(6,182,212,0.65)"   },
  { key: "prismatic", label: "Prismatic",  from: null,      to: null,      text: "text-fuchsia-400",  glow: null, rainbow: true       },
];

const TIME_POINTS_PER_MIN = 2.5; // gentle visual heat for time on app (not persisted)

/** Build an HSL rainbow gradient string from a hue offset (0–360). */
function rainbowGradient(hueOffset: number, direction: "90deg" | "to bottom"): string {
  // 6 stops spread across the spectrum, offset by hueOffset so it rotates.
  const stops = [0, 60, 120, 180, 240, 300, 360].map((h) => {
    const hue = (h + hueOffset) % 360;
    return `hsl(${hue},85%,62%)`;
  });
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

export function GrindMeter({ mode, streak, answered = 0, startedAt, className, hidden, compact }: GrindMeterProps) {
  // Persistent grind state (per user/day). Hydrated after mount (SSR-safe).
  const [state, setState] = useState<GrindState>({ date: "", level: 0, seenToday: 0 });
  useEffect(() => {
    setState(loadGrind());
    return subscribeGrind(setState);
  }, []);

  // Time-on-app this session for a subtle extra heat (only ever grows).
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setMinutes((Date.now() - startedAt) / 60000);
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [startedAt]);

  // ── Record grind events from prop deltas (measured from mount) ───────────────
  const prevAnswered = useRef<number | null>(null);
  const prevStreak = useRef(streak);
  useEffect(() => {
    if (prevAnswered.current === null) {
      // First observation after mount — establish baseline, don't record.
      prevAnswered.current = answered;
      prevStreak.current = streak;
      return;
    }
    const delta = answered - prevAnswered.current;
    if (delta > 0) {
      if (mode === "flashcard") {
        recordFlashcardSeen(delta);
      } else {
        // Quiz: a rise in the consecutive-correct streak means the new answer
        // was correct; otherwise it was wrong (multiplier resets, no drop).
        const correct = streak > prevStreak.current;
        for (let i = 0; i < delta; i++) recordQuizAnswer(correct && i === delta - 1);
      }
    }
    prevAnswered.current = answered;
    prevStreak.current = streak;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, streak, mode]);

  // ── Rainbow hue tick (useEffect-driven, NOT in render path) ─────────────────
  // Rotates ~3° per second for a slow, meditative shimmer.
  const [hueOffset, setHueOffset] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHueOffset((h) => (h + 1) % 360), 333);
    return () => clearInterval(id);
  }, []);

  // ── Derived heat ─────────────────────────────────────────────────────────────
  const displayPoints = state.level + (startedAt ? minutes * TIME_POINTS_PER_MIN : 0);
  const heat = heatFromLevel(displayPoints);
  const fillPct = Math.round(heat * 100);
  const overdrive = overdriveFromLevel(displayPoints);

  // Cyclic bar (compact header meter): fills left→right, laps to a hotter tier
  // each full fill, and goes rainbow after enough laps.
  const { cycle, fill: cycleFill } = cycleProgress(displayPoints);

  // Tier selection:
  //   - overdrive ≥ 2  → Prismatic (rainbow)
  //   - 0 < overdrive < 2 → Supernova
  //   - otherwise → original 0..4 tiers mapped from heat
  let tierIdx: number;
  if (overdrive >= 2) {
    tierIdx = 6; // Prismatic
  } else if (overdrive > 0) {
    tierIdx = 5; // Supernova
  } else {
    tierIdx = Math.min(4, Math.floor(heat * 5));
    // Don't show a hot flame on essentially-zero grind.
    if (displayPoints < 6) tierIdx = 0;
  }
  const tier = TIERS[tierIdx]!;

  const flameScale = 0.85 + heat * 0.6;
  const pulse = tierIdx >= 2;

  // Pop the flame on a fresh grind event (level rose).
  const [animKey, setAnimKey] = useState(0);
  const prevLevel = useRef(state.level);
  useEffect(() => {
    if (state.level > prevLevel.current) setAnimKey((k) => k + 1);
    prevLevel.current = state.level;
  }, [state.level]);

  // Flash the compact bar each time it laps (reaches full and resets hotter).
  const [lapKey, setLapKey] = useState(0);
  const prevCycle = useRef<number | null>(null);
  useEffect(() => {
    if (prevCycle.current !== null && cycle > prevCycle.current) setLapKey((k) => k + 1);
    prevCycle.current = cycle;
  }, [cycle]);

  const ariaLabel =
    mode === "flashcard"
      ? `Grind meter: ${tier.label}, ${state.seenToday} cards seen today`
      : `Grind meter: ${tier.label}`;

  // Gradient values for the flame SVG stop colors and the heat bar.
  // For rainbow tier we pull live hsl strings; otherwise use the tier's fixed colors.
  const gradFrom = tier.rainbow
    ? `hsl(${hueOffset % 360},85%,62%)`
    : (tier.from ?? "#f87171");
  const gradTo = tier.rainbow
    ? `hsl(${(hueOffset + 150) % 360},85%,62%)`
    : (tier.to ?? "#7c3aed");
  const barBackground = tier.rainbow
    ? rainbowGradient(hueOffset, "90deg")
    : `linear-gradient(90deg, ${gradFrom}, ${gradTo})`;
  const glowColor = tier.rainbow
    ? `hsla(${(hueOffset + 60) % 360},80%,65%,0.55)`
    : (tier.glow ?? "transparent");

  // Hidden mode: all the recording effects above still ran; render nothing.
  if (hidden) return null;

  // Flame element shared by the full bar and the compact chip.
  const flame = (
    <span
      key={`flame-${animKey}`}
      className={cn(
        "relative inline-flex items-center justify-center shrink-0",
        animKey > 0 && "motion-safe:animate-[lodera-correct-pop_320ms_cubic-bezier(0.34,1.56,0.64,1)]"
      )}
      style={{ width: 22, height: 22 }}
    >
      <span
        aria-hidden
        className={cn("absolute inset-0 rounded-full blur-[6px]", pulse && "motion-safe:animate-pulse")}
        style={{ background: glowColor }}
      />
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        style={{ transform: `scale(${flameScale})`, transition: "transform 300ms ease" }}
        aria-hidden
      >
        <defs>
          <linearGradient id={`grind-flame-${tier.key}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={gradFrom} />
            <stop offset="100%" stopColor={gradTo} />
          </linearGradient>
        </defs>
        <path
          d="M12 2c1.5 3.2-1.8 4.6-1.8 7.2 0 1 .7 1.8 1.6 1.8.7 0 1.3-.4 1.6-1 .9 1 1.4 2.3 1.4 3.6A5.4 5.4 0 0 1 12 19a5.4 5.4 0 0 1-2.8-9.9C8 7.2 8.6 4.4 12 2z"
          fill={`url(#grind-flame-${tier.key})`}
        />
      </svg>
    </span>
  );

  // Compact CYCLIC bar (header corner): a small grind bar that fills left→right,
  // laps to a hotter colour each time it fills, and goes rainbow after enough
  // laps. The fill accelerates while a correct-streak multiplier is active
  // (level climbs faster), and each lap flashes. Replaces the old flame-only chip.
  if (compact) {
    // Start cold; every completed lap shifts the colour one tier warmer.
    const cIdx = Math.min(TIERS.length - 1, cycle);
    const cTier = TIERS[cIdx]!;
    const cRainbow = !!cTier.rainbow;
    const cFrom = cRainbow ? `hsl(${hueOffset % 360},85%,62%)` : (cTier.from ?? "#fb923c");
    const cTo = cRainbow ? `hsl(${(hueOffset + 150) % 360},85%,62%)` : (cTier.to ?? "#ef4444");
    const cBar = cRainbow
      ? rainbowGradient(hueOffset, "90deg")
      : `linear-gradient(90deg, ${cFrom}, ${cTo})`;
    const cGlow = cRainbow
      ? `hsla(${(hueOffset + 60) % 360},80%,65%,0.6)`
      : (cTier.glow ?? "rgba(251,146,60,0.35)");
    const barFillPct = Math.max(5, Math.round(cycleFill * 100));

    return (
      <div
        className={cn("inline-flex items-center gap-1.5 select-none", className)}
        aria-live="polite"
        aria-label={`${ariaLabel}, lap ${cycle + 1}`}
        title={`${cTier.label}${cycle > 0 ? ` · lap ${cycle + 1}` : ""}`}
      >
        {/* Tiny tier-coloured flame accent */}
        <span
          key={`cflame-${animKey}`}
          className={cn(
            "relative inline-flex items-center justify-center shrink-0",
            animKey > 0 && "motion-safe:animate-[lodera-correct-pop_320ms_cubic-bezier(0.34,1.56,0.64,1)]"
          )}
          style={{ width: 16, height: 16 }}
        >
          <span
            aria-hidden
            className={cn("absolute inset-0 rounded-full blur-[5px]", cIdx >= 3 && "motion-safe:animate-pulse")}
            style={{ background: cGlow }}
          />
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
            <defs>
              <linearGradient id={`grind-cflame-${cTier.key}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={cFrom} />
                <stop offset="100%" stopColor={cTo} />
              </linearGradient>
            </defs>
            <path
              d="M12 2c1.5 3.2-1.8 4.6-1.8 7.2 0 1 .7 1.8 1.6 1.8.7 0 1.3-.4 1.6-1 .9 1 1.4 2.3 1.4 3.6A5.4 5.4 0 0 1 12 19a5.4 5.4 0 0 1-2.8-9.9C8 7.2 8.6 4.4 12 2z"
              fill={`url(#grind-cflame-${cTier.key})`}
            />
          </svg>
        </span>

        {/* Cyclic bar — flashes on each lap */}
        <div
          key={`lap-${lapKey}`}
          className={cn(
            "h-1.5 w-24 sm:w-32 rounded-full bg-neutral-200/70 overflow-hidden",
            lapKey > 0 && "motion-safe:animate-[lodera-correct-pop_320ms_cubic-bezier(0.34,1.56,0.64,1)]"
          )}
        >
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${barFillPct}%`,
              background: cBar,
              boxShadow: `0 0 6px ${cGlow}`,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-2.5 w-full select-none", className)}
      aria-live="polite"
      aria-label={ariaLabel}
    >
      {flame}

      {/* Heat bar */}
      <div className="flex-1 min-w-0">
        <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.max(6, fillPct)}%`,
              background: barBackground,
            }}
          />
        </div>
      </div>

      {/* Label + mode-specific subtle metric */}
      <span className={cn("shrink-0 text-xs font-semibold tabular-nums flex items-center gap-1.5", tier.text)}>
        <span>{tier.label}</span>
        {mode === "flashcard" && (
          <span className="font-medium text-neutral-400" aria-hidden>
            · {state.seenToday} seen today
          </span>
        )}
      </span>
    </div>
  );
}

export default GrindMeter;
