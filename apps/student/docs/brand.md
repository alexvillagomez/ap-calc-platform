# Lodera.ai — Brand Guidelines

## Palette

### Brand blues
| Token      | Hex       | Usage                          |
|------------|-----------|--------------------------------|
| brand-50   | `#eff6ff` | Tinted backgrounds, hover fill |
| brand-100  | `#dbeafe` | Light chip backgrounds         |
| brand-200  | `#bfdbfe` | Borders on brand surfaces      |
| brand-300  | `#93c5fd` | Decorative accents             |
| brand-400  | `#60a5fa` | Icons, secondary text          |
| **brand-500** | **`#3b82f6`** | **Primary CTA, links, active states** |
| **brand-600** | **`#4f46e5`** | **Hover on primary, indigo accent** |
| brand-700  | `#4338ca` | Dark text on light brand bg    |
| brand-800  | `#3730a3` | Deep emphasis                  |
| brand-900  | `#312e81` | Near-navy, heavy emphasis      |

Logo gradient axis: `#38bdf8` (sky-400) → `#6366f1` (indigo-500).

### Neutrals (blue-cast slate)
| Token        | Hex       |
|--------------|-----------|
| neutral-50   | `#f8fafc` |
| neutral-100  | `#f1f5f9` |
| neutral-200  | `#e2e8f0` |
| neutral-300  | `#cbd5e1` |
| neutral-400  | `#94a3b8` |
| neutral-500  | `#64748b` |
| neutral-600  | `#475569` |
| neutral-700  | `#334155` |
| neutral-800  | `#1e293b` |
| neutral-900  | `#0f172a` |

### Semantic
| Token        | Hex       | Usage                    |
|--------------|-----------|--------------------------|
| success-500  | `#10b981` | Correct, mastered, done  |
| success-600  | `#059669` | Hover on success         |
| error-500    | `#f43f5e` | Incorrect, alert         |
| error-600    | `#e11d48` | Hover on error           |

---

## Logo

The mark is a geometric 4-point north-star / sparkle (not a clipart 5-point star): four elongated
tapered lobes meeting at the center, vertical axis slightly dominant. The gradient runs sky-400 → indigo-500
from top-left to bottom-right.

**Usage rules**
- Minimum rendered size: 16px height for mark-only, 28px for mark + wordmark.
- On dark backgrounds: use the SVG as-is (gradient reads well on dark).
- On colored brand backgrounds: use white fill variant (override `fill="white"`).
- Clear space: at least half the mark height on all sides.
- Do not rotate, distort, recolor with brand grays, or add drop shadows to the mark.

**Wordmark**: "Lodera" — Inter 600 or system-ui, tracking -0.02em. Title case. ".ai" is omitted
from the wordmark to keep it clean; "Lodera.ai" appears in copy and metadata only.

---

## Voice

- **Short.** Sentences under 12 words whenever possible.
- **Encouraging without cheerleading.** "Nice work" > "AMAZING!!!! You're a genius!!!"
- **Honest.** If something's hard, say so. Learning is effort — that's the point.
- **Active.** "Practice now" > "Start your practice session."
- **Never cutesy-overload.** One emoji maximum per UI string. Prefer none in error states.

---

## Animation principles

1. **Subtle and fast.** Correct-answer pop is 320ms; most transitions are 150–200ms.
2. **Purposeful.** Animation signals a state change — never decorative looping.
3. **Skippable.** All animations respect `prefers-reduced-motion` (add `motion-safe:` prefix where needed).
4. **Consistent timing functions:** `cubic-bezier(0.34,1.56,0.64,1)` for pops (slight overshoot);
   `ease-out` for fades and bar fills; `ease-in-out` for page transitions.

---

## Sound principles

1. **Quiet by default.** Peak gain is 0.08–0.12 (roughly -20 dBFS). Never startling.
2. **Synthesized, not sampled.** WebAudio oscillators only — no audio files to load.
3. **Mutable, persisted.** `lodera_sound_muted` localStorage key. Respect it everywhere.
4. **Tone mapping:**
   - Correct: rising two-note chime (880 Hz → 1320 Hz), 150ms total.
   - Incorrect: single soft 280 Hz triangle tone, 180ms — gentle, not punishing.
   - Streak: 5-note ascending arpeggio (C5–E6), ~375ms total.
5. **SSR-safe.** AudioContext is created lazily on first user gesture. Never at module scope.
