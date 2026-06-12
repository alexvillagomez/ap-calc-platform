/**
 * Lodera sound system — WebAudio synthesised sounds, no audio files.
 * SSR-safe: AudioContext is created lazily on first user gesture.
 *
 * Exports:
 *   playCorrect()    — two-note rising chime, ~150ms, quiet
 *   playIncorrect()  — single soft low tone, gentle
 *   playStreak()     — sparkle arpeggio, 5 notes
 *   useSoundPreference() — React hook: { muted, toggleMute }
 *   SoundToggle      — small speaker button component (components/ui/SoundToggle)
 *
 * Mute state: persisted to localStorage key "lodera_sound_muted".
 */

const STORAGE_KEY = "lodera_sound_muted";

// ── AudioContext singleton (lazy, client-side only) ───────────────────────────

let _ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_ctx) {
    try {
      _ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  // Resume if suspended (browser autoplay policy)
  if (_ctx.state === "suspended") {
    _ctx.resume().catch(() => {});
  }
  return _ctx;
}

// ── Mute helpers ──────────────────────────────────────────────────────────────

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, String(muted));
  // Notify other hooks
  window.dispatchEvent(new CustomEvent("lodera-sound-mute-change", { detail: muted }));
}

export function toggleMute(): void {
  setMuted(!isMuted());
}

// ── Low-level tone builder ────────────────────────────────────────────────────

interface ToneOptions {
  freq: number;
  startTime: number;
  duration: number;
  gainPeak?: number;
  type?: OscillatorType;
  ctx: AudioContext;
}

function playTone({ freq, startTime, duration, gainPeak = 0.12, type = "sine", ctx }: ToneOptions): void {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);

  // Envelope: short attack, fade out
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Short, pleasant two-note rising chime (~150ms). */
export function playCorrect(): void {
  if (isMuted()) return;
  const ctx = getCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone({ ctx, freq: 880,  startTime: t,        duration: 0.10 });
  playTone({ ctx, freq: 1320, startTime: t + 0.06, duration: 0.10 });
}

/** Single soft, slightly low tone — not punishing. */
export function playIncorrect(): void {
  if (isMuted()) return;
  const ctx = getCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone({ ctx, freq: 280, startTime: t, duration: 0.18, gainPeak: 0.08, type: "triangle" });
}

/** Sparkle arpeggio for a streak — 5 ascending notes. */
export function playStreak(): void {
  if (isMuted()) return;
  const ctx = getCtx();
  if (!ctx) return;
  const t      = ctx.currentTime;
  const freqs  = [523, 659, 784, 988, 1319]; // C5 E5 G5 B5 E6
  const step   = 0.065;
  freqs.forEach((freq, i) => {
    playTone({ ctx, freq, startTime: t + i * step, duration: 0.12, gainPeak: 0.10 });
  });
}
