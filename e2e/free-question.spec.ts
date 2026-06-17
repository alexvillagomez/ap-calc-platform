/**
 * Free-question trial — unauthenticated visitor experience.
 *
 * Verifies:
 *  1. The landing page shows a "Try a free question first" link.
 *  2. /try loads a real question with no auth (fresh context, zero cookies).
 *  3. Choosing an answer reveals correct/incorrect feedback.
 *  4. The sign-up CTA is visible after answering.
 *  5. A second question is NOT served — choices become disabled; no "Next" button.
 *
 * Uses a fresh browser context (no cookies, no localStorage) for every test.
 *
 * Run: E2E_BASE_URL=http://localhost:3002 npx playwright test free-question
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3002";

test.describe("Free question trial (unauthenticated)", () => {
  test("landing page shows Try a free question entry", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    // Land a returning-but-unauthenticated visitor straight on the subject
    // selector (onboarding already seen) so this test targets the entry link
    // deterministically, without racing the onboarding cold-compile.
    await page.addInitScript(() => localStorage.setItem("lodera_onboarding_done", "1"));
    await page.goto(BASE);

    // The "Try a free question" link should be visible on the subject selector.
    const tryLink = page.getByTestId("try-question-link");
    await expect(tryLink).toBeVisible({ timeout: 15000 });

    await ctx.close();
  });

  test("answers one question and sees sign-up CTA; no second question served", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    // Visit /try directly — public route, no auth.
    await page.goto(`${BASE}/try`);

    // Wait for question choices to load.
    const choiceList = page.getByTestId("choice-list");
    await expect(choiceList).toBeVisible({ timeout: 20000 });

    const choices = choiceList.locator("button");
    await expect(choices).toHaveCount(4, { timeout: 10000 });

    // Answer: pick the first choice.
    await choices.first().click();

    // Feedback panel must appear.
    const feedbackPanel = page.getByTestId("feedback-panel");
    await expect(feedbackPanel).toBeVisible({ timeout: 5000 });

    // Sign-up CTA must be present with expected copy.
    const signupCta = page.getByTestId("signup-cta");
    await expect(signupCta).toBeVisible({ timeout: 5000 });
    await expect(signupCta).toContainText("Create a free account");

    // All choice buttons should now be disabled (no re-answering).
    const count = await choices.count();
    for (let i = 0; i < count; i++) {
      await expect(choices.nth(i)).toBeDisabled();
    }

    // No "Next question" button — page stays terminal after one question.
    await expect(page.getByRole("button", { name: /next question/i })).toHaveCount(0);

    await ctx.close();
  });

  test("sign-up CTA links to /login", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/try`);
    await expect(page.getByTestId("choice-list")).toBeVisible({ timeout: 20000 });

    // Answer any choice.
    await page.getByTestId("choice-list").locator("button").first().click();

    // Ensure the sign-up link points at /login.
    const signupLink = page.getByRole("link", { name: /sign up free/i });
    await expect(signupLink).toBeVisible({ timeout: 5000 });
    const href = await signupLink.getAttribute("href");
    expect(href).toMatch(/\/login/);

    await ctx.close();
  });
});
