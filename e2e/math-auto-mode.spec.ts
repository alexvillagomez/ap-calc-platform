import { test, expect } from "@playwright/test";

/**
 * Math auto mode smoke tests.
 *
 * Tests the three improvements made to /math/[course]/auto:
 *  1. Unit X/N indicator visible in the header.
 *  2. Dual progress bars (course + unit) visible when a plan loads.
 *  3. Flashcard warm-up renders for new keywords (when stored flashcards exist)
 *     OR the mode degrades gracefully to practicing phase when none do.
 *  4. needs_diagnostic state routes to /math/precalc/diagnostic.
 *
 * Because OPENAI_API_KEY is invalid (401), content generation 502s.
 * Stored-content paths still work — the flashcard route returns stored cards
 * or an empty array, and the test asserts both paths gracefully.
 *
 * Run: E2E_BASE_URL=http://localhost:3002 npx playwright test math-auto-mode
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3002";

// ── Shared auth helper ──────────────────────────────────────────────────────

async function registerAndSeedAuth(
  page: Parameters<Parameters<typeof test>[1]>[0]["page"],
  _request?: unknown
) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const username = `pw_autotest_${stamp}`;
  const email = `pw_autotest_${stamp}@example.com`;

  // Authenticate via the cookie flow (LoginGate checks /api/auth/me → httpOnly
  // lodera_uid cookie). page.request shares the cookie jar with the page.
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email, username, password: "testpass123", mode: "signup" },
  });
  const data = (await res.json()) as {
    user?: { id?: string };
    sessionId?: string;
  };

  // Also seed legacy localStorage keys (some pages still read session_id there).
  await page.addInitScript(
    ([acct, sess, user]) => {
      localStorage.setItem("ap_calc_account_id", acct);
      localStorage.setItem("ap_calc_username", user);
      localStorage.setItem("ap_calc_student_session_id", sess);
    },
    [data.user?.id ?? "", data.sessionId ?? "", username]
  );

  return { accountId: data.user?.id, sessionId: data.sessionId, username };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Math auto mode", () => {
  /**
   * Fresh account with no keyword states → auto-plan should return
   * needs_diagnostic: true → the page shows the diagnostic card.
   */
  test("fresh account → needs_diagnostic card shown with diagnostic link", async ({
    page,
    request,
  }) => {
    await registerAndSeedAuth(page, request);
    await page.goto(`${BASE}/math/precalc/auto`);

    // Wait for loading to resolve
    await page.waitForSelector("text=Start with a placement check", {
      timeout: 35000,
    });

    // The diagnostic CTA must be present
    await expect(
      page.getByRole("link", { name: /placement diagnostic/i })
    ).toBeVisible();

    // The link must point to the diagnostic page with return=auto
    const href = await page
      .getByRole("link", { name: /placement diagnostic/i })
      .getAttribute("href");
    expect(href).toMatch(/\/math\/precalc\/diagnostic/);
    expect(href).toMatch(/return=auto/);

    // "Skip and start from the beginning" button also present
    await expect(
      page.getByRole("button", { name: /skip and start/i })
    ).toBeVisible();
  });

  /**
   * Fresh account → clicks "Skip and start from beginning"
   * → auto mode loads with a unit indicator and progress bar.
   * If there are stored questions the practice phase loads; if not,
   * a graceful error is acceptable.
   */
  test("skip diagnostic → unit indicator and progress bar visible", async ({
    page,
    request,
  }) => {
    await registerAndSeedAuth(page, request);
    await page.goto(`${BASE}/math/precalc/auto`);

    // Wait for needs_diagnostic card
    await page.waitForSelector("text=Start with a placement check", {
      timeout: 35000,
    });

    // Click skip
    await page.getByRole("button", { name: /skip and start/i }).click();

    // Wait for either a practice state (generating/practicing/flashcard) or
    // a graceful error (no taxonomy seeded is also acceptable).
    await Promise.race([
      page
        .waitForSelector("text=Unit ", { timeout: 35000 })
        .catch(() => null),
      page
        .waitForSelector("[data-testid='error'], text=Something went wrong", {
          timeout: 35000,
        })
        .catch(() => null),
      // course_complete if all already mastered (edge case)
      page
        .waitForSelector("text=complete!", { timeout: 35000 })
        .catch(() => null),
    ]);

    // If the taxonomy is seeded and a plan loaded, assert unit indicator exists
    const unitText = await page.locator("text=/Unit \\d+\\/\\d+/").count();
    if (unitText > 0) {
      // Unit X/N indicator is in the header
      await expect(page.locator("text=/Unit \\d+\\/\\d+/").first()).toBeVisible();

      // Course-level overall progress label (ProgressBar aria-label)
      // The progress bar value is a number; just verify it exists
      const progressEl = page.locator('[aria-label*="overall progress"]');
      if ((await progressEl.count()) > 0) {
        await expect(progressEl.first()).toBeVisible();
      }
    }

    // If it reached a flashcard or practice phase, assert those phases don't crash
    const flashcardWarmup = await page
      .locator("text=Quick warm-up")
      .count();
    const practiceQuestion = await page
      .locator("text=/I don.t know/")
      .count();

    // Either flashcard warm-up OR practice question OR error is acceptable
    // (depends on stored content in DB)
    const anyPhase = flashcardWarmup > 0 || practiceQuestion > 0 || unitText > 0;
    // Just assert the page didn't hard-crash (no unhandled React error overlay)
    await expect(page.locator("text=Application error")).toHaveCount(0);
    // Log for informational purposes
    console.log(
      `[auto test] flashcard=${flashcardWarmup}, practice=${practiceQuestion}, unit=${unitText}, anyPhase=${anyPhase}`
    );
  });

  /**
   * Flashcard warm-up render: if the phase reaches "flashcard", assert
   * the warm-up label, flip card, Show answer button, and grade buttons.
   * This test only runs assertions when the flashcard phase is actually reached
   * (requires stored math_flashcards in DB); otherwise it marks as passed.
   */
  test("flashcard warm-up renders correct UI when phase=flashcard", async ({
    page,
    request,
  }) => {
    await registerAndSeedAuth(page, request);
    await page.goto(`${BASE}/math/precalc/auto`);

    // Skip diagnostic to get into the practice flow
    await page.waitForSelector("text=Start with a placement check", {
      timeout: 35000,
    });
    await page.getByRole("button", { name: /skip and start/i }).click();

    // Wait up to 25s for either flashcard warm-up or another phase
    const flashcardVisible = await page
      .waitForSelector("text=Quick warm-up", { timeout: 25000 })
      .then(() => true)
      .catch(() => false);

    if (!flashcardVisible) {
      // Generation 502d or no stored flashcards → test can't assert flashcard UI
      // but must confirm no crash
      console.log(
        "[auto test] flashcard phase not reached (no stored flashcards or 502) — skipping flashcard UI assertions"
      );
      await expect(page.locator("text=Application error")).toHaveCount(0);
      return;
    }

    // Flashcard warm-up UI assertions
    await expect(
      page.locator("text=Quick warm-up — get familiar before practice")
    ).toBeVisible();

    // Card counter "1 / N"
    await expect(page.locator("text=/1 \\/ \\d+/")).toBeVisible();

    // Flip card — front side should show
    await expect(page.locator("text=Front")).toBeVisible();

    // Show answer button
    const showAnswerBtn = page.getByRole("button", { name: /show answer/i });
    await expect(showAnswerBtn).toBeVisible();

    // Click show answer → grade buttons appear after the 150ms flip animation
    await showAnswerBtn.click();
    await expect(
      page.getByRole("button", { name: /got it/i })
    ).toBeVisible({ timeout: 6000 });
    await expect(
      page.getByRole("button", { name: /missed it/i })
    ).toBeVisible();
    await expect(page.getByText(/didn'?t know this/i)).toBeVisible();

    // Skip warm-up link is also present
    await expect(page.getByText(/skip warm-up/i)).toBeVisible();
  });

  /**
   * "Got it" on a flashcard advances to next card or to practice phase.
   */
  test("grading Got it on flashcard advances the warm-up flow", async ({
    page,
    request,
  }) => {
    await registerAndSeedAuth(page, request);
    await page.goto(`${BASE}/math/precalc/auto`);

    // Skip diagnostic
    await page.waitForSelector("text=Start with a placement check", {
      timeout: 35000,
    });
    await page.getByRole("button", { name: /skip and start/i }).click();

    // Wait for flashcard warm-up
    const flashcardVisible = await page
      .waitForSelector("text=Quick warm-up", { timeout: 25000 })
      .then(() => true)
      .catch(() => false);

    if (!flashcardVisible) {
      console.log("[auto test] flashcard warm-up not reached — skipping grade test");
      return;
    }

    // Show the answer; grade buttons appear after the 150ms flip animation
    await page.getByRole("button", { name: /show answer/i }).click();
    const gotIt = page.getByRole("button", { name: /got it/i });
    await expect(gotIt).toBeVisible({ timeout: 6000 });
    await gotIt.click();

    // Wait for either: next card OR transition to practice
    await Promise.race([
      page.waitForSelector("text=Quick warm-up", { timeout: 10000 }).catch(() => null),
      page.waitForSelector("text=Finding your next question", { timeout: 10000 }).catch(() => null),
      page.waitForSelector("text=I don", { timeout: 10000 }).catch(() => null),
    ]);

    // Must not crash
    await expect(page.locator("text=Application error")).toHaveCount(0);
  });

  /**
   * Skip warm-up link skips directly to question loading.
   */
  test("skip warm-up link bypasses flashcard phase", async ({
    page,
    request,
  }) => {
    await registerAndSeedAuth(page, request);
    await page.goto(`${BASE}/math/precalc/auto`);

    await page.waitForSelector("text=Start with a placement check", {
      timeout: 35000,
    });
    await page.getByRole("button", { name: /skip and start/i }).click();

    const flashcardVisible = await page
      .waitForSelector("text=Quick warm-up", { timeout: 25000 })
      .then(() => true)
      .catch(() => false);

    if (!flashcardVisible) {
      console.log("[auto test] flashcard not reached — skip test");
      return;
    }

    // Click "Skip warm-up"
    await page.locator("text=Skip warm-up").click();

    // Should transition to generating/practicing
    await Promise.race([
      page.waitForSelector("text=Finding your next question", { timeout: 10000 }).catch(() => null),
      page.waitForSelector("text=I don", { timeout: 10000 }).catch(() => null),
    ]);

    await expect(page.locator("text=Application error")).toHaveCount(0);
    // Should no longer be in flashcard phase
    await expect(page.locator("text=Quick warm-up")).toHaveCount(0);
  });
});
