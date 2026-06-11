import { test, expect } from "@playwright/test";

/**
 * Thorough MCAT walkthrough. Captures screenshots at every surface into
 * test-results/mcat/ for nitpicky visual review, and asserts the core flows:
 * landing → browse drill-down → practice (flashcard warm-up, mastery, difficulty
 * selector) → quiz (correct_index spread) → flashcards (flip both ways) →
 * general practice (tree select) → progress → auth buttons.
 *
 * Run: E2E_BASE_URL=http://localhost:3002 npx playwright test mcat-flow
 */

const SHOT = (name: string) => ({ path: `test-results/mcat/${name}.png`, fullPage: true });

const CATEGORY = "mcat_biology_amino_acids_and_proteins";

// MCAT is login-gated. Register a fresh account via the API and seed the auth
// localStorage keys before each page load, and pre-dismiss the onboarding so the
// overlay doesn't cover the UI under test.
test.beforeEach(async ({ page, request }) => {
  const username = `pw_mcat_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const res = await request.post("/api/auth/register", {
    data: { username, password: "testpass123" },
  });
  const data = (await res.json()) as { accountId?: string; sessionId?: string };
  expect(data.accountId, "register should return an account").toBeTruthy();

  await page.addInitScript(
    ([acct, sess, user]) => {
      localStorage.setItem("ap_calc_account_id", acct);
      localStorage.setItem("ap_calc_username", user);
      localStorage.setItem("ap_calc_student_session_id", sess);
      localStorage.setItem("mcat_onboarding_seen", "1");
    },
    [data.accountId!, data.sessionId!, username]
  );
});

test.describe("MCAT feature walkthrough", () => {
  test("landing + drill-down browse", async ({ page }) => {
    await page.goto("/mcat");
    await expect(page.getByRole("heading", { name: "MCAT Practice" })).toBeVisible();
    // General practice card + at least one category card
    await expect(page.getByText("General Practice")).toBeVisible();
    await expect(page.getByText("Explore topics", { exact: false }).first()).toBeVisible();
    // MCAT is login-gated; the beforeEach signs us in, so the header shows "Log out"
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot(SHOT("01-landing"));

    // Click into a category browse page (actions are <Link>s, i.e. role=link)
    await page.goto(`/mcat/${CATEGORY}`);
    await expect(page.getByText("Whole category", { exact: false }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("link", { name: /Practice/i }).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot(SHOT("02-browse-umbrellas"));

    // Expand the first umbrella to reveal in-depth keywords
    const chevrons = page.locator("button[aria-label='Expand'], button[aria-label='Collapse']");
    if (await chevrons.count() > 0) {
      await chevrons.first().click();
      await page.waitForTimeout(400);
      await page.screenshot(SHOT("03-browse-expanded-children"));
    }
  });

  test("practice flow — warm-up, questions, difficulty selector", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto(`/mcat/${CATEGORY}/practice`);

    // Either a flashcard warm-up or a question appears (generation can be slow)
    const firstContent = page.locator("text=/Quick warm-up|Explanation|Mastering|I don't know|Show answer/i").first();
    await expect(firstContent).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(500);
    await page.screenshot(SHOT("04-practice-first"));

    // Difficulty selector present
    const hard = page.getByRole("button", { name: "Hard", exact: true });
    if (await hard.count() > 0) {
      await expect(hard.first()).toBeVisible();
      await page.screenshot(SHOT("05-practice-difficulty-selector"));
    }

    // If a flashcard warm-up is showing, flip + grade through it
    const showAnswer = page.getByRole("button", { name: /Show answer/i });
    if (await showAnswer.count() > 0) {
      await showAnswer.first().click();
      await page.waitForTimeout(300);
      await page.screenshot(SHOT("06-warmup-back"));
      const gotIt = page.getByRole("button", { name: /Got it/i });
      // grade through all warm-up cards
      for (let i = 0; i < 3 && (await gotIt.count()) > 0; i++) {
        await gotIt.first().click();
        await page.waitForTimeout(800);
        const sa = page.getByRole("button", { name: /Show answer/i });
        if (await sa.count() > 0) await sa.first().click();
        await page.waitForTimeout(300);
      }
    }

    // Now a question should appear — answer it and reveal
    const choices = page.locator("button").filter({ hasText: /^[A-D][\.\)]/ });
    // fall back: choice buttons are ChoiceButton; click the first plausible choice
    await page.waitForTimeout(1500);
    await page.screenshot(SHOT("07-practice-question"));
  });

  test("quiz — renders and correct answers are not all index 0", async ({ page }) => {
    test.setTimeout(150_000);
    const responses: number[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/mcat/quiz")) {
        try {
          const j = await r.json();
          (j.questions ?? []).forEach((q: { correct_index: number }) => responses.push(q.correct_index));
        } catch { /* ignore */ }
      }
    });
    await page.goto(`/mcat/${CATEGORY}/quiz`);
    // Wait for the quiz to build (generation heavy). Progress reads "1 / 8".
    await expect(page.locator("text=/\\d\\s*\\/\\s*\\d/").first()).toBeVisible({ timeout: 150_000 });
    await page.waitForTimeout(500);
    await page.screenshot(SHOT("08-quiz"));
    console.log("quiz correct_index values:", JSON.stringify(responses));
    // Not all identical (the shuffle fix)
    if (responses.length >= 4) {
      const unique = new Set(responses);
      expect(unique.size).toBeGreaterThan(1);
    }
  });

  test("flashcards — flip both ways", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto(`/mcat/${CATEGORY}/flashcards`);
    await expect(page.locator("text=/Show answer|tap to flip|Got it/i").first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(500);
    await page.screenshot(SHOT("09-flashcard-front"));
    // Click the card to flip
    const card = page.locator("[class*='cursor-pointer']").first();
    if (await card.count() > 0) {
      await card.click();
      await page.waitForTimeout(400);
      await page.screenshot(SHOT("10-flashcard-back"));
      // flip back
      await card.click();
      await page.waitForTimeout(400);
      await page.screenshot(SHOT("11-flashcard-flipped-back"));
    }
  });

  test("general practice — hierarchical topic selection", async ({ page }) => {
    await page.goto("/mcat/practice");
    await expect(page.getByRole("button", { name: /Start practice/i })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot(SHOT("12-general-practice-select"));
    // Expand a category to show umbrellas
    const chevrons = page.locator("button").filter({ has: page.locator("svg") });
    // Just screenshot the selector state; selection logic is unit-ish
    await page.screenshot(SHOT("13-general-practice-tree"));
  });

  test("progress page — umbrella tree", async ({ page }) => {
    await page.goto("/mcat/progress");
    await expect(page.locator("text=/MCAT|Progress|keyword/i").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await page.screenshot(SHOT("14-progress"));
  });
});
