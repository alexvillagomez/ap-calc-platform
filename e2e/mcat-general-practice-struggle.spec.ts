import { test, expect } from "@playwright/test";

/**
 * MCAT General Practice — struggle detection (Issue #8).
 *
 * Verifies that:
 *  1. After ≥2 consecutive wrong answers the "Struggling?" lesson-offer banner
 *     is pushed automatically (the user did NOT open the toolbar or click it).
 *  2. The banner is NOT present after only 1 wrong answer.
 *  3. "Take a lesson" opens the lesson page in a new tab.
 *
 * /mcat/practice has no auth gate — it is publicly accessible. We seed
 * localStorage with a session (mirroring mcat-flow.spec.ts) so the internal
 * session and taxonomy APIs work correctly.
 *
 * Run: E2E_BASE_URL=http://localhost:3002 npx playwright test mcat-general-practice-struggle
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3002";

// Register a fresh session + seed localStorage before each test (same pattern
// as mcat-flow.spec.ts).
test.beforeEach(async ({ page, request }) => {
  const username = `pw_struggle_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const res = await request.post("/api/auth/register", {
    data: { username, password: "testpass123" },
  });
  const data = (await res.json()) as {
    accountId?: string;
    sessionId?: string;
  };
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Navigate to General Practice, select all, and start — wait for first Q. */
async function startPractice(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/mcat/practice`, { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("button", { name: /Start practice/i })
  ).toBeVisible({ timeout: 30_000 });

  const selectAll = page.getByRole("button", { name: /Select all/i });
  if (await selectAll.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await selectAll.click();
  }

  await page.getByRole("button", { name: /Start practice/i }).click();

  // Wait for the first question (answering phase shows "I don't know")
  await expect(page.getByText(/I don.t know/i).first()).toBeVisible({
    timeout: 90_000,
  });
}

/** Answer wrong: click "I don't know" → reveals answer (counts as a miss). */
async function answerWrong(page: import("@playwright/test").Page) {
  await expect(page.getByText(/I don.t know/i).first()).toBeVisible({
    timeout: 90_000,
  });
  await page.getByText(/I don.t know/i).first().click();
  await expect(
    page.getByRole("button", { name: /Next question →/i }).first()
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Move to the next question. Prefers "Similar question" (re-uses the same
 * stored question variant) over "Next question →" (which may hit generation)
 * to make the test more reliable when the stored-question pool is thin.
 */
async function nextQuestion(page: import("@playwright/test").Page) {
  // Try "Similar question" first — it always returns a stored variant and is fast.
  const similarBtn = page.getByRole("button", { name: /Similar question/i }).first();
  const nextBtn = page.getByRole("button", { name: /Next question →/i }).first();

  const useSimilar =
    await similarBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  if (useSimilar) {
    await similarBtn.click();
  } else {
    await nextBtn.click();
  }
  await expect(page.getByText(/I don.t know/i).first()).toBeVisible({
    timeout: 90_000,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("MCAT General Practice — struggle detection", () => {
  test.setTimeout(300_000);

  test("banner appears after 2 consecutive wrong answers, not after 1", async ({
    page,
  }) => {
    await startPractice(page);

    // ── Miss #1 — banner must NOT show yet ────────────────────────────────
    await answerWrong(page);

    // Use the amber container as the locator to distinguish from the
    // QuestionToolbar's "Take a lesson" button
    const bannerLocator = page
      .locator("div.bg-amber-50")
      .filter({ hasText: /Struggling/i });

    await expect(bannerLocator).toHaveCount(0);

    // ── Miss #2 — banner MUST appear ─────────────────────────────────────
    await nextQuestion(page);
    await answerWrong(page);

    await expect(bannerLocator).toBeVisible({ timeout: 5_000 });

    // Both CTA buttons must be present inside the banner
    await expect(
      bannerLocator.getByRole("button", { name: /Take a lesson/i })
    ).toBeVisible({ timeout: 3_000 });
    await expect(
      bannerLocator.getByRole("button", { name: /Keep practicing/i })
    ).toBeVisible({ timeout: 3_000 });

    // ── Dismiss → banner disappears ───────────────────────────────────────
    await bannerLocator
      .getByRole("button", { name: /Keep practicing/i })
      .click();
    await expect(bannerLocator).toHaveCount(0);

    // ── Only 1 more wrong after dismiss → no re-trigger ───────────────────
    // The ref was reset on dismiss (lessonedKeywordsRef tracks shown keywords).
    // consecutiveWrongRef is 1 after the next wrong — threshold is 2 → no banner.
    await nextQuestion(page);
    await answerWrong(page);
    await expect(bannerLocator).toHaveCount(0);
  });

  test("'Take a lesson' opens the lesson in a new tab", async ({
    page,
    context,
  }) => {
    await startPractice(page);

    // Trigger banner with 2 consecutive misses
    await answerWrong(page);
    await nextQuestion(page);
    await answerWrong(page);

    const bannerLocator = page
      .locator("div.bg-amber-50")
      .filter({ hasText: /Struggling/i });
    await expect(bannerLocator).toBeVisible({ timeout: 5_000 });

    // "Take a lesson" opens a new tab (window.open _blank)
    const newTabPromise = context.waitForEvent("page", { timeout: 15_000 });
    await bannerLocator
      .getByRole("button", { name: /Take a lesson/i })
      .click();
    const newTab = await newTabPromise;
    expect(newTab).toBeTruthy();

    await newTab
      .waitForLoadState("domcontentloaded", { timeout: 15_000 })
      .catch(() => {});

    // Lesson URL must contain /mcat/lesson/<keyword-id>
    expect(newTab.url()).toContain("/mcat/lesson/");

    // Original page stays on /mcat/practice (session preserved)
    expect(page.url()).toContain("/mcat/practice");

    // Banner is dismissed after clicking "Take a lesson"
    await expect(bannerLocator).toHaveCount(0);
  });
});
