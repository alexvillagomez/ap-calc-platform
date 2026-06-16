import { test } from "@playwright/test";

/**
 * Features-v2 visual QA capture. Drives the whole student app with Playwright
 * (no computer-use / no manual browser) and screenshots EVERY page + the new
 * features into test-results/qa-v2/ so the 10 persona reviewers can read real
 * PNGs and critique aesthetics + content.
 *
 * Covers: home, login, profile (edit+save, password validation), math hub +
 * search, math practice (toolbar: stopwatch / quick-refresher / take-a-lesson /
 * prioritize), math quiz, math lesson, math progress, and the MCAT equivalents
 * incl. flashcards.
 *
 * Requires the dev server on :3002 AND a reachable Supabase project.
 * Run: E2E_BASE_URL=http://localhost:3002 npx playwright test features-v2-qa
 *
 * Capture is resilient: each interaction is best-effort (wrapped) so a single
 * missing selector never aborts the screenshot run.
 */

const DIR = "test-results/qa-v2";
const SHOT = (name: string) => ({ path: `${DIR}/${name}.png`, fullPage: true });

// Known-good ids observed during the build.
const MATH_COURSE = "precalc";
const MATH_CATEGORY = "number_systems";
const MCAT_CATEGORY = "mcat_biology_amino_acids_and_proteins";

// Resilient capture: settle the page, give async content a beat, screenshot.
async function cap(page: import("@playwright/test").Page, name: string) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot(SHOT(name)).catch((e) => {
    console.log(`screenshot ${name} failed: ${String(e).slice(0, 120)}`);
  });
}

// Best-effort click by accessible name (link or button); never throws.
async function tryClick(page: import("@playwright/test").Page, name: RegExp, timeout = 4000) {
  try {
    const el = page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();
    await el.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

// Auth: lodera login auto-signs-up and sets the httpOnly lodera_uid cookie on the
// browser context (page.request shares the cookie jar). Also seed legacy
// localStorage session keys so MCAT (login-gated) and onboarding skips work.
test.beforeEach(async ({ page }) => {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const email = `pw_qa_${stamp}@example.com`;
  const username = `pw_qa_${stamp}`;
  let userId = "";
  let sessionId = "";
  try {
    const res = await page.request.post("/api/auth/login", {
      data: { email, username, password: "testpass123" },
    });
    const data = (await res.json()) as { user?: { id?: string }; sessionId?: string };
    userId = data.user?.id ?? "";
    sessionId = data.sessionId ?? "";
  } catch (e) {
    console.log("login failed (Supabase down?):", String(e).slice(0, 120));
  }
  await page.addInitScript(
    ([acct, sess, user]) => {
      try {
        if (acct) localStorage.setItem("ap_calc_account_id", acct);
        if (user) localStorage.setItem("ap_calc_username", user);
        if (sess) localStorage.setItem("ap_calc_student_session_id", sess);
        localStorage.setItem("mcat_onboarding_seen", "1");
        localStorage.setItem("math_onboarding_seen", "1");
        localStorage.setItem("lodera_onboarding_seen", "1");
      } catch {
        /* ignore */
      }
    },
    [userId, sessionId, username]
  );
});

test.describe("Features-v2 visual QA", () => {
  test("auth + profile", async ({ page }) => {
    await page.goto("/");
    await cap(page, "00-home");

    await page.goto("/login");
    await cap(page, "01-login");

    await page.goto("/profile");
    await cap(page, "02-profile");

    // Edit a personal-info field and save (expect a success toast).
    try {
      const first = page.getByLabel(/first name/i).or(page.locator('input[name="first_name"]')).first();
      await first.fill("QA", { timeout: 4000 });
      await tryClick(page, /save/i);
      await page.waitForTimeout(1200);
      await cap(page, "03-profile-saved");
    } catch {
      /* best effort */
    }

    // Trigger password validation with a too-short new password.
    try {
      await page.getByLabel(/current password/i).first().fill("testpass123", { timeout: 3000 });
      await page.getByLabel(/new password/i).first().fill("abc", { timeout: 3000 });
      await tryClick(page, /update password/i);
      await page.waitForTimeout(600);
      await cap(page, "04-profile-pw-validation");
    } catch {
      /* best effort */
    }
  });

  test("math journey", async ({ page }) => {
    await page.goto("/math");
    await cap(page, "10-math-home");

    await page.goto(`/math/${MATH_COURSE}`);
    await cap(page, "11-math-hub");

    // Course search (cosine similarity).
    try {
      const box = page.getByPlaceholder(/search/i).first();
      await box.fill("factoring quadratics", { timeout: 4000 });
      await box.press("Enter");
      await page.waitForTimeout(2500);
      await cap(page, "12-math-search-results");
    } catch {
      /* best effort */
    }

    // Category practice (where the QuestionToolbar lives).
    await page.goto(`/math/${MATH_COURSE}/${MATH_CATEGORY}/practice`);
    await cap(page, "13-math-practice");

    // Quick refresher inline panel.
    if (await tryClick(page, /quick refresher|refresher/i)) {
      await page.waitForTimeout(2500);
      await cap(page, "14-math-refresher-open");
    }
    // Prioritize this topic.
    if (await tryClick(page, /prioritize/i)) {
      await page.waitForTimeout(800);
      await cap(page, "15-math-prioritized");
    }

    await page.goto(`/math/${MATH_COURSE}/${MATH_CATEGORY}/quiz`);
    await cap(page, "16-math-quiz");

    await page.goto(`/math/${MATH_COURSE}/practice`);
    await cap(page, "17-math-general-practice");

    await page.goto(`/math/${MATH_COURSE}/progress`);
    await cap(page, "18-math-progress");
  });

  test("mcat journey", async ({ page }) => {
    await page.goto("/mcat");
    await cap(page, "20-mcat-home");

    // MCAT search.
    try {
      const box = page.getByPlaceholder(/search/i).first();
      await box.fill("cellular respiration", { timeout: 4000 });
      await box.press("Enter");
      await page.waitForTimeout(2500);
      await cap(page, "21-mcat-search-results");
    } catch {
      /* best effort */
    }

    await page.goto(`/mcat/${MCAT_CATEGORY}`);
    await cap(page, "22-mcat-browse");

    await page.goto(`/mcat/${MCAT_CATEGORY}/practice`);
    await cap(page, "23-mcat-practice");
    if (await tryClick(page, /quick refresher|refresher/i)) {
      await page.waitForTimeout(2500);
      await cap(page, "24-mcat-refresher-open");
    }
    if (await tryClick(page, /prioritize/i)) {
      await page.waitForTimeout(800);
      await cap(page, "25-mcat-prioritized");
    }

    await page.goto(`/mcat/${MCAT_CATEGORY}/quiz`);
    await cap(page, "26-mcat-quiz");

    await page.goto(`/mcat/${MCAT_CATEGORY}/flashcards`);
    await cap(page, "27-mcat-flashcards");
    // Flip the card.
    try {
      await page.locator("body").click({ position: { x: 400, y: 300 }, timeout: 2000 });
      await page.waitForTimeout(600);
      await cap(page, "28-mcat-flashcard-back");
    } catch {
      /* best effort */
    }

    await page.goto("/mcat/progress");
    await cap(page, "29-mcat-progress");
  });
});
