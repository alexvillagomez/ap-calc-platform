"use client";

/**
 * useSoundPreference — React hook for mute state.
 * SoundToggle — small speaker icon button component.
 *
 * Both are client-only (sound.ts is SSR-safe but the hook uses useState/useEffect).
 */
import { useEffect, useState } from "react";
import { isMuted, toggleMute } from "@/lib/sound";
import { cn } from "@/lib/cn";

export function useSoundPreference(): { muted: boolean; toggleMute: () => void } {
  const [muted, setMuted] = useState<boolean>(false);

  useEffect(() => {
    // Read initial value from localStorage (client-only)
    setMuted(isMuted());

    const handler = (e: Event) => {
      setMuted((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener("lodera-sound-mute-change", handler);
    return () => window.removeEventListener("lodera-sound-mute-change", handler);
  }, []);

  const handleToggle = () => {
    toggleMute();
    // Optimistic update (event also fires, but this is immediate)
    setMuted((prev) => !prev);
  };

  return { muted, toggleMute: handleToggle };
}

// ── SoundToggle ───────────────────────────────────────────────────────────────

interface SoundToggleProps {
  className?: string;
}

export function SoundToggle({ className }: SoundToggleProps) {
  const { muted, toggleMute: handleToggle } = useSoundPreference();

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={muted}
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      title={muted ? "Unmute sounds" : "Mute sounds"}
      className={cn(
        "inline-flex items-center justify-center w-8 h-8 rounded-lg",
        "text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1",
        className
      )}
    >
      {muted ? <SpeakerOffIcon /> : <SpeakerOnIcon />}
    </button>
  );
}

function SpeakerOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 5.5h2.5L8 3v10L4.5 10.5H2a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z"
        fill="currentColor"
      />
      <path
        d="M10.5 5.5c.83.83 1.33 1.97 1.33 3.18 0 1.2-.5 2.34-1.33 3.18M12.5 3.5C14 5 14.83 6.45 14.83 8.18c0 1.73-.83 3.18-2.33 4.68"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 5.5h2.5L8 3v10L4.5 10.5H2a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z"
        fill="currentColor"
        opacity="0.45"
      />
      <path
        d="M10.5 5.5 13.5 8.5M13.5 5.5 10.5 8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default SoundToggle;
