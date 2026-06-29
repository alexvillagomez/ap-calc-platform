import { useState, useEffect } from "react";

/**
 * Returns true when the viewport is ≥ 1024px (Tailwind `lg` breakpoint).
 * SSR-safe: always returns false on the server and on the first client render
 * so hydration matches, then updates via a matchMedia listener inside useEffect.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);

    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}
