"use client";

/**
 * Course Portal — the top-level track chooser (Math vs MCAT).
 *
 * Always reachable from the shared NavMenu ("Course Portal") and from Home, so a
 * student can return here at any time to switch tracks. Picking a track records
 * the last-center hint and routes to that section's home (/math or /mcat), which
 * carry their own login gates.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { NavMenu } from "@/components/nav/NavMenu";
import { cn } from "@/lib/cn";

const LAST_CENTER_KEY = "lodera_last_center";

export default function CoursePortalPage() {
  const router = useRouter();

  function choose(center: "math" | "mcat") {
    try {
      localStorage.setItem(LAST_CENTER_KEY, center);
    } catch {
      /* ignore */
    }
    router.push(center === "math" ? "/math" : "/mcat");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-brand-50/30 to-white">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LoderaLogo size={28} withWordmark />
            <span className="text-neutral-300 text-sm">|</span>
            <h1 className="text-sm font-semibold text-neutral-800">Course Portal</h1>
          </div>
          <NavMenu />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
        <div className="space-y-2 text-center mb-10">
          <LoderaLogo size={36} className="mx-auto mb-4" />
          <h2 className="text-3xl font-bold text-neutral-900 tracking-tight">What are you studying?</h2>
          <p className="text-neutral-400 text-sm">Pick a track — you can switch any time from the menu.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Math */}
          <button onClick={() => choose("math")} className="group text-left" aria-label="Study Math">
            <Card
              hover
              className={cn(
                "h-full flex flex-col gap-4 transition-all duration-200 cursor-pointer",
                "group-hover:border-brand-300 group-hover:shadow-brand-md group-focus-visible:ring-2 group-focus-visible:ring-brand-400"
              )}
            >
              <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center text-2xl shadow-brand-xs">
                📐
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-neutral-900 text-lg">Math</h3>
                </div>
                <p className="text-sm text-neutral-500 leading-relaxed">
                  Precalc foundations through AP Calc AB. Adaptive practice, spaced review, instant mastery tracking.
                </p>
              </div>
              <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                {["Precalc", "AP Calc AB", "Adaptive"].map((t) => (
                  <span
                    key={t}
                    className="text-xs text-brand-600 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded-full font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Card>
          </button>

          {/* MCAT */}
          <button onClick={() => choose("mcat")} className="group text-left" aria-label="Study MCAT">
            <Card
              hover
              className={cn(
                "h-full flex flex-col gap-4 transition-all duration-200 cursor-pointer",
                "group-hover:border-violet-300 group-hover:shadow-[0_4px_16px_0_rgb(124_58_237/0.12)] group-focus-visible:ring-2 group-focus-visible:ring-violet-400"
              )}
            >
              <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center text-2xl shadow-brand-xs">
                🧬
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-neutral-900 text-lg">MCAT</h3>
                </div>
                <p className="text-sm text-neutral-500 leading-relaxed">
                  Biology now — Chemistry, Physics, and Psych/Soc next. AI-generated questions at every yield level.
                </p>
              </div>
              <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                {["Biology", "Chemistry", "Psych/Soc"].map((t) => (
                  <span
                    key={t}
                    className="text-xs text-violet-600 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Card>
          </button>
        </div>

        <p className="mt-8 text-center text-xs text-neutral-400">
          Your progress saves automatically and is kept separate per track.{" "}
          <Link href="/" className="font-medium text-brand-600 hover:text-brand-700">
            Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
