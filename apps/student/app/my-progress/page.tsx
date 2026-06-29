"use client";

/**
 * /my-progress — the full "My Progress" points page. The MyProgressChip
 * navigates here from home routes; elsewhere it shows the same panel in a popup.
 */

import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { NavMenu } from "@/components/nav/NavMenu";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import MyProgressPanel from "@/components/gamification/MyProgressPanel";

export default function MyProgressPage() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white">
        <div className="w-full flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link href="/" className="shrink-0">
              <LoderaLogo size={20} />
            </Link>
            <p className="truncate text-sm font-semibold text-neutral-900">
              My Progress
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StreakBadge />
            <NavMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <MyProgressPanel />
      </main>
    </div>
  );
}
