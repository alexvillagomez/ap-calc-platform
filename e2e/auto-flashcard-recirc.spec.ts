import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Verifies the auto-mode flashcard recirculation fix in MCAT auto mode.
 *
 * The fix: missed cards now come back after a few other cards (Anki-style
 * spacing), the deck does NOT complete until every card is memorized, and
 * a "Memorized X of N" progress line is visible.
 *
 * Assertions:
 *   (a) NO-EARLY-END:  sequence.length > distinct card count (missed card recirculated)
 *   (b) RE-SHOW:       first card's front text appears ≥ 2 times
 *   (c) SPACING:       the two appearances are separated by ≥ 1 different card
 *
 * Auth: signs up via /api/auth/signup then drives the /login page (sets SSR cookies).
 *
 * Run: npx playwright test auto-flashcard-recirc
 */

const SHOT_DIR = "test-results/auto-flashcard-recirc";

function shotPath(name: string) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, `${name}.png`);
}

async function signUpAndSignIn(page: Page): Promise<{ userId: string }> {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const email = `pw_fcr_${stamp}@example.com`;
  const password = "testpass123";
  const username = `pw_fcr_${stamp}`;

  // 1. Create the pre-confirmed Supabase user
  const res = await page.request.post("/api/auth/signup", {
    data: { email, username, password },
  });
  expect(res.ok(), `signup should succeed (got ${res.status()})`).toBeTruthy();
  const data = (await res.json()) as { ok?: boolean; userId?: string; error?: string };
  expect(data.ok, `signup ok (error: ${data.error ?? "none"})`).toBeTruthy();
  const userId = data.userId!;

  // 2. Sign in via the /login page (sets @supabase/ssr cookies)
  await page.goto("/login?next=/mcat/auto");
  await page.locator("#lp-email").fill(email);
  await page.locator("#lp-password").fill(password);
  await page.locator("form").getByRole("button", { name: /^Log in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
  console.log(`[recirc] authenticated as ${email}, now at ${page.url()}`);

  // 3. Pre-seed a student_sessions row (required for FK integrity in mcat_* tables).
  //    The MCAT auto page does this via getOrCreateMcatSession() → /api/session, but
  //    we need it done BEFORE we navigate so our pre-seeded diagnostic skip persists.
  await page.request.post("/api/session", { data: { sessionId: userId } });

  // 4. Pre-seed a completed mcat_diagnostic_sessions row so the diagnostic gate
  //    never appears. getOrCreateMcatSession() returns the auth uid as session_id.
  const skipRes = await page.request.post("/api/mcat/diagnostic/skip", {
    data: { session_id: userId },
  });
  const skipData = (await skipRes.json()) as { ok?: boolean; error?: string };
  console.log(`[recirc] pre-seeded diagnostic skip: ok=${skipData.ok ?? false}, err=${skipData.error ?? "none"}`);

  return { userId };
}

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
  // Note: signUpAndSignIn already navigates to /mcat/auto
});

test("auto-mode flashcard recirculation — missed cards come back", async ({ page }) => {
  test.setTimeout(300_000);

  if (!page.url().includes("/mcat/auto")) {
    await page.goto("/mcat/auto");
  }

  // ── Step 1: Ensure we're past the diagnostic gate ─────────────────────────
  // The diagnostic skip was pre-seeded in beforeEach. If somehow the gate still
  // appears (race condition), click it once.
  const diagnosticSkipBtn = page.getByRole("button", { name: /Skip and start from the beginning/i });
  if (await diagnosticSkipBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    console.log("[recirc] diagnostic gate visible (unexpected), clicking skip");
    await diagnosticSkipBtn.click();
    await page.waitForTimeout(3_000);
  }

  await page.screenshot({ path: shotPath("01-after-diagnostic-skip"), fullPage: true });

  // ── Step 2: Wait for the LESSON phase ─────────────────────────────────────
  // LessonView fetches /api/mcat/lesson — can take 5–30s.
  // Lesson controls rendered by LessonView: "Skip" (small footer btn) and
  // "Continue" / "Next page" (forward nav). These appear when lesson content loads.
  // The flashcard phase has "Show answer".
  //
  // Key: we need specific selectors that ONLY match lesson or flashcard phase,
  // not the diagnostic gate.

  const flashcardShowAnswer = page.getByRole("button", { name: /^Show answer$/i });
  // LessonView's skip button has exact text "Skip lesson" (top-right, small underline button)
  const lessonSkipControl = page.locator("button").filter({ hasText: /^Skip lesson$/i }).first();

  console.log("[recirc] waiting for lesson content or flashcard...");
  let lessonDetected = false;

  // Wait up to 60s for either the lesson or the flashcard
  const raceResult = await Promise.race([
    lessonSkipControl.waitFor({ timeout: 120_000 }).then(() => "lesson"),
    flashcardShowAnswer.first().waitFor({ timeout: 120_000 }).then(() => "flashcard"),
  ]).catch(() => "timeout");

  console.log(`[recirc] phase detected: ${raceResult}`);
  await page.screenshot({ path: shotPath("02-phase-detected"), fullPage: true });

  if (raceResult === "timeout") {
    throw new Error("Timed out waiting for lesson or flashcard phase after 60s");
  }

  lessonDetected = raceResult === "lesson";

  // ── Step 3: Navigate through the lesson to flashcards ────────────────────
  if (lessonDetected) {
    console.log("[recirc] skipping through lesson...");
    // Click the Skip control repeatedly until we reach flashcards
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await flashcardShowAnswer.isVisible({ timeout: 1_000 }).catch(() => false)) {
        console.log(`[recirc] reached flashcards after ${attempt} lesson clicks`);
        break;
      }

      // Try "Skip lesson" (LessonView top-right control)
      const skipBtn = page.locator("button").filter({ hasText: /^Skip lesson$/i }).first();
      if (await skipBtn.isVisible({ timeout: 800 }).catch(() => false)) {
        await skipBtn.click();
        await page.waitForTimeout(600);
        continue;
      }

      // Try "Continue" / "Next page" (in-lesson forward navigation)
      const contBtn = page.locator("button").filter({ hasText: /^(Continue|Next page)$/i }).first();
      if (await contBtn.isVisible({ timeout: 800 }).catch(() => false)) {
        await contBtn.click();
        await page.waitForTimeout(600);
        continue;
      }

      // Nothing to click — lesson still loading or transitioning
      await page.waitForTimeout(2_000);
    }

    // Definitive wait for "Show answer"
    console.log("[recirc] waiting for Show answer button (flashcard gen)...");
    await flashcardShowAnswer.first().waitFor({ timeout: 90_000 });
  }

  // ── Step 4: Confirm flashcard phase ──────────────────────────────────────
  await page.screenshot({ path: shotPath("03-flashcard-phase"), fullPage: true });
  console.log("[recirc] flashcard phase confirmed");

  // ── Step 5: Drive the deck — MISS first, GOT IT for the rest ─────────────
  const sequence: string[] = [];
  const memorizedLine: string[] = [];
  const SAFETY_CAP = 45;

  for (let i = 0; i < SAFETY_CAP; i++) {
    const saVisible = await flashcardShowAnswer.isVisible({ timeout: 3_000 }).catch(() => false);
    const missedItBtn = page.getByRole("button", { name: /^Missed it$/i });
    const gotItBtn = page.getByRole("button", { name: /^Got it$/i });
    const miVisible = await missedItBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    const giVisible = await gotItBtn.isVisible({ timeout: 1_000 }).catch(() => false);

    if (!saVisible && !miVisible && !giVisible) {
      // Check for transition to practice questions: ChoiceButton with A/B/C/D or "I don't know" link
      const dontKnowPractice = page.locator("text=/I don't know/i").first();
      const choiceA = page.locator("button").filter({ hasText: /^A[.)]\s/ }).first();
      const isPractice =
        (await dontKnowPractice.isVisible({ timeout: 2_000 }).catch(() => false)) ||
        (await choiceA.isVisible({ timeout: 1_000 }).catch(() => false));
      if (isPractice) {
        console.log(`[recirc] transitioned to practice questions at step ${i}`);
        break;
      }
      console.log(`[recirc] step ${i}: no flashcard UI (loading?), waiting 3s...`);
      await page.waitForTimeout(3_000);
      continue;
    }

    // Read progress line
    const progressEl = page.locator("p").filter({ hasText: /Memorized \d+ of \d+/ }).first();
    const progressText = await progressEl.textContent({ timeout: 1_500 }).catch(() => "");
    if (progressText) memorizedLine.push(progressText.trim());

    // Read front text (only available when "Show answer" is visible — front face)
    let frontText = `<back-${i}>`;
    if (saVisible) {
      // Try to read the visible card content
      // The FlipCard button's innerText when on front: "Front\n{content}\ntap to flip"
      const cardBtn = page.locator("button").filter({ has: page.locator("p", { hasText: /^Front$/i }) }).first();
      if (await cardBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        const raw = await cardBtn.innerText({ timeout: 3_000 }).catch(() => "");
        frontText = raw
          .replace(/^Front\s*/i, "")
          .replace(/\s*tap to flip\s*$/i, "")
          .trim();
      } else {
        // Fallback: any rounded-2xl button (the card)
        const anyCard = page.locator("button[class*='rounded-2xl']").first();
        const raw = await anyCard.innerText({ timeout: 3_000 }).catch(() => "");
        frontText = raw.replace(/^Front\s*/i, "").replace(/\s*tap to flip\s*$/i, "").trim();
      }
      if (!frontText) frontText = `<empty-${i}>`;
    }

    console.log(`[recirc] step ${i}: front="${frontText.slice(0, 70)}" | ${progressText.trim()}`);
    sequence.push(frontText);

    // Grade the card
    if (saVisible) {
      // Flip to back
      await flashcardShowAnswer.click();
      await page.waitForTimeout(300);
    }

    if (i === 0) {
      // MISS the first card
      await missedItBtn.waitFor({ timeout: 10_000 });
      await page.screenshot({ path: shotPath("04-first-card-back"), fullPage: true });
      console.log(`[recirc] step ${i}: MISSING first card`);
      await missedItBtn.click();
    } else {
      // GOT IT for all others
      const gotItVisible2 = await gotItBtn.isVisible({ timeout: 10_000 }).catch(() => false);
      if (!gotItVisible2) {
        // Deck may have just completed — check if we're on practice now
        const dontKnow2 = page.locator("text=/I don't know/i").first();
        if (await dontKnow2.isVisible({ timeout: 2_000 }).catch(() => false)) {
          console.log(`[recirc] step ${i}: deck completed → practice. Breaking.`);
          break;
        }
        console.log(`[recirc] step ${i}: Got it not visible, waiting...`);
        await page.waitForTimeout(2_000);
        // Re-check
        if (!(await gotItBtn.isVisible({ timeout: 5_000 }).catch(() => false))) break;
      }

      if (frontText === sequence[0] && !frontText.startsWith("<back-")) {
        console.log(`[recirc] step ${i}: FIRST CARD REAPPEARED at position ${i}!`);
        await page.screenshot({ path: shotPath(`05-reappeared-at-${i}`), fullPage: true });
      }

      await gotItBtn.click();
    }

    await page.waitForTimeout(500);
  }

  // ── Final screenshot ──────────────────────────────────────────────────────
  await page.screenshot({ path: shotPath("06-after-deck"), fullPage: true });

  // ── Analysis ──────────────────────────────────────────────────────────────
  console.log("\n═══ RECORDED SEQUENCE ═══");
  sequence.forEach((t, i) => console.log(`  [${i}] "${t.slice(0, 80)}"`));
  console.log("\n═══ MEMORIZED LINES ═══");
  memorizedLine.forEach((t, i) => console.log(`  [${i}] ${t}`));

  expect(sequence.length, "should have driven ≥3 cards").toBeGreaterThan(2);

  const firstFront = sequence[0];
  const firstCardPositions = sequence.reduce<number[]>((acc, t, i) => {
    if (t === firstFront) acc.push(i);
    return acc;
  }, []);

  const distinctFronts = new Set(sequence.filter((t) => !t.startsWith("<")));
  console.log(`\n  distinct fronts: ${distinctFronts.size}`);
  console.log(`  total cards shown: ${sequence.length}`);
  console.log(`  first card: "${firstFront?.slice(0, 80)}"`);
  console.log(`  first card positions: [${firstCardPositions.join(", ")}]`);

  // (a) NO-EARLY-END
  const seqExceedsDistinct = sequence.length > distinctFronts.size;
  console.log(`\n(a) NO-EARLY-END: ${sequence.length} > ${distinctFronts.size} → ${seqExceedsDistinct ? "PASS" : "FAIL"}`);

  // (b) RE-SHOW
  const firstCardReappeared = firstCardPositions.length >= 2;
  console.log(`(b) RE-SHOW: positions [${firstCardPositions.join(", ")}] → ${firstCardReappeared ? "PASS" : "FAIL"}`);

  // (c) SPACING
  let spacingOk = false;
  if (firstCardPositions.length >= 2) {
    const [p1, p2] = firstCardPositions;
    const gap = p2! - p1!;
    spacingOk = gap >= 2;
    const between = sequence.slice(p1! + 1, p2!);
    console.log(`(c) SPACING: ${p1} → ${p2}, gap=${gap} → ${spacingOk ? "PASS" : "FAIL"}`);
    console.log(`    between: [${between.map((t) => `"${t.slice(0, 40)}"`).join(", ")}]`);
  } else {
    console.log(`(c) SPACING: only ${firstCardPositions.length} appearance(s), cannot check`);
  }

  expect(seqExceedsDistinct, `(a) FAIL: sequence.length=${sequence.length}, distinct=${distinctFronts.size}`).toBe(true);
  expect(firstCardReappeared, `(b) FAIL: first card appeared only ${firstCardPositions.length} time(s)`).toBe(true);
  expect(spacingOk, `(c) FAIL: back-to-back reappearance at positions [${firstCardPositions.join(", ")}]`).toBe(true);

  console.log("\n✓ All three PASS — flashcard recirculation is working.");
});
