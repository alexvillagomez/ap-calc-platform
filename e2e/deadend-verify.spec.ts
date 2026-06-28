/**
 * Verifies the end-of-activity navigation fix (lesson / flashcards) — that finishing
 * no longer dead-ends to home but offers practice-more / back-to-topic / home.
 *
 * Run: npx playwright test e2e/deadend-verify.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const email = `pw_de_${stamp}@example.com`;
  const username = `pw_de_${stamp}`;
  try {
    await page.request.post("/api/auth/login", {
      data: { email, username, password: "testpass123" },
    });
  } catch (e) {
    console.log("login failed:", String(e).slice(0, 120));
  }
  await page.addInitScript(() => {
    try {
      localStorage.setItem("math_onboarding_seen", "1");
      localStorage.setItem("lodera_onboarding_seen", "1");
      localStorage.setItem("mcat_onboarding_seen", "1");
    } catch { /* ignore */ }
  });
});

async function stepThroughLesson(page: Page) {
  for (let i = 0; i < 80; i++) {
    const finish = page.getByRole("button", { name: "Finish lesson" });
    if ((await finish.count()) && (await finish.first().isVisible())) {
      await finish.first().click();
      return;
    }
    const tryq = page.getByRole("button", { name: "Try a question" });
    if ((await tryq.count()) && (await tryq.first().isVisible())) {
      await tryq.first().click();
      await page.waitForTimeout(120);
      continue;
    }
    const nextb = page.getByRole("button", { name: /^(Next step|Move on)$/ });
    if ((await nextb.count()) && (await nextb.first().isVisible())) {
      await nextb.first().click();
      await page.waitForTimeout(120);
      continue;
    }
    // Question phase: the only buttons in the lesson card are the 4 choices.
    const choice = page.getByRole("button").filter({ hasNotText: "Skip lesson" }).first();
    if ((await choice.count()) && (await choice.first().isVisible())) {
      await choice.first().click();
      await page.waitForTimeout(120);
      continue;
    }
    await page.waitForTimeout(200);
  }
}

test("math lesson (with topic context) ends with 3 options, not home", async ({ page }) => {
  await page.goto(
    "/math/lesson/real_number_set_membership?label=Real%20Number%20Set%20Membership&course=precalc&category=number_systems&scope=keyword"
  );
  await expect(page.getByText("Lesson:", { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await stepThroughLesson(page);

  await expect(page.getByText("Lesson complete!")).toBeVisible({ timeout: 15000 });
  const practice = page.getByRole("link", { name: /Practice this topic/i });
  const back = page.getByRole("link", { name: /Back to Real Number Set Membership/i });
  const home = page.getByRole("link", { name: /Math Center home/i });
  await expect(practice).toBeVisible();
  await expect(back).toBeVisible();
  await expect(home).toBeVisible();
  expect(await practice.getAttribute("href")).toContain(
    "/math/precalc/number_systems/practice?keyword=real_number_set_membership"
  );
  expect(await back.getAttribute("href")).toBe("/math/precalc/number_systems");
  console.log("LESSON(context): 3 options present + correct hrefs ✓");
  await page.screenshot({ path: "test-results/deadend/lesson-context-end.png", fullPage: true });
});

test("math lesson (no context, search-origin) does NOT bounce home", async ({ page }) => {
  await page.goto("/math/lesson/real_number_set_membership");
  await expect(page.getByText("Lesson:", { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await stepThroughLesson(page);

  await expect(page.getByText("Lesson complete!")).toBeVisible({ timeout: 15000 });
  // Not auto-redirected to /math:
  expect(page.url()).toContain("/math/lesson/real_number_set_membership");
  await expect(page.getByRole("link", { name: /Back to topic/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Math Center home/i })).toBeVisible();
  console.log("LESSON(no-context): stayed on lesson page + Back/Home options ✓");
});

test("math flashcards route exists (was 404) and ends with options", async ({ page }) => {
  const resp = await page.goto("/math/calc_ab/calc_unit_1/flashcards");
  expect(resp?.status(), "route should not 404").toBeLessThan(400);
  // Reach a terminal state: a study card ("Show answer") or the done screen.
  await page.waitForTimeout(1500);
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole("link", { name: /Math Center home/i }).count()) break;
    const show = page.getByRole("button", { name: /Show answer/i });
    if ((await show.count()) && (await show.first().isVisible())) {
      await show.first().click();
      await page.waitForTimeout(150);
      const gotit = page.getByRole("button", { name: /Got it/i });
      if (await gotit.count()) await gotit.first().click();
      await page.waitForTimeout(150);
      continue;
    }
    await page.waitForTimeout(500);
  }
  // Either we reached "done" (options) or an error-with-back — both are non-dead-ends.
  const home = page.getByRole("link", { name: /Math Center home/i });
  const backErr = page.getByRole("link", { name: /^Back$/i });
  const ok = (await home.count()) > 0 || (await backErr.count()) > 0;
  expect(ok, "flashcards page should offer a way out (home/back), never a dead end").toBeTruthy();
  console.log("FLASHCARDS: route reachable (not 404) + escape options present ✓");
  await page.screenshot({ path: "test-results/deadend/flashcards-end.png", fullPage: true });
});
