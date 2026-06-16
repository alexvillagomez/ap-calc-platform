import { test, type Page } from "@playwright/test";

/**
 * 10 simultaneous persona users (run with --workers=10). Each persona does a
 * LONG extensive pass (every surface + every feature for its course) and a
 * SHORT quick pass, screenshotting each surface into
 * test-results/personas/<key>/ for in-character review by the analysis agents.
 *
 * Math personas (17yo) run the math journey; MCAT personas (21yo) run the MCAT
 * journey; all do the shared home/login/profile surfaces. Collectively this
 * exercises ALL features with 5x perspectives per course.
 *
 * Run: E2E_BASE_URL=http://localhost:3002 npx playwright test persona-runs --workers=10
 */

type Persona = { key: string; course: "math" | "mcat"; age: number };
const PERSONAS: Persona[] = [
  { key: "maya", course: "math", age: 17 },
  { key: "jordan", course: "math", age: 17 },
  { key: "priya", course: "math", age: 17 },
  { key: "tyler", course: "math", age: 17 },
  { key: "sofia", course: "math", age: 17 },
  { key: "daniel", course: "mcat", age: 21 },
  { key: "aisha", course: "mcat", age: 21 },
  { key: "chris", course: "mcat", age: 21 },
  { key: "lena", course: "mcat", age: 21 },
  { key: "marcus", course: "mcat", age: 21 },
];

const MATH_COURSE = "precalc";
const MATH_CATEGORY = "number_systems";
const MCAT_CATEGORY = "mcat_biology_amino_acids_and_proteins";

const shot = (key: string, name: string) => ({ path: `test-results/personas/${key}/${name}.png`, fullPage: true });

async function cap(page: Page, key: string, name: string) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot(shot(key, name)).catch(() => {});
}

async function tryClick(page: Page, name: RegExp, timeout = 4000) {
  try {
    await page.getByRole("button", { name }).or(page.getByRole("link", { name })).first().click({ timeout });
    return true;
  } catch {
    return false;
  }
}

// Answer the on-screen MCQ (pick the first choice) and advance; best-effort.
async function answerMcq(page: Page) {
  try {
    const choice = page.getByRole("button").filter({ hasText: /^[A-D][).]?\s|.+/ }).first();
    await choice.click({ timeout: 3000 });
    await page.waitForTimeout(800);
  } catch {
    /* ignore */
  }
  await tryClick(page, /^(next|continue|next question)$/i, 3000);
  await page.waitForTimeout(600);
}

async function login(page: Page, key: string) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const email = `pw_${key}_${stamp}@example.com`;
  const username = `pw_${key}_${stamp}`;
  let userId = "";
  let sessionId = "";
  try {
    const res = await page.request.post("/api/auth/login", {
      data: { email, username, password: "testpass123" },
    });
    const data = (await res.json()) as { user?: { id?: string }; sessionId?: string };
    userId = data.user?.id ?? "";
    sessionId = data.sessionId ?? "";
  } catch {
    /* Supabase issue — surfaces as login gate in screenshots */
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
  return { username };
}

async function sharedSurfaces(page: Page, key: string) {
  await page.goto("/");
  await cap(page, key, "00-home");
  await page.goto("/profile");
  await cap(page, key, "01-profile");
  // Edit personal info + save (expect success toast).
  try {
    await page.getByLabel(/first name/i).or(page.locator('input[name="first_name"]')).first().fill("Test", { timeout: 3000 });
    await tryClick(page, /save/i);
    await page.waitForTimeout(1000);
    await cap(page, key, "02-profile-saved");
  } catch {
    /* ignore */
  }
  // Password validation (too short).
  try {
    await page.getByLabel(/current password/i).first().fill("testpass123", { timeout: 2500 });
    await page.getByLabel(/new password/i).first().fill("abc", { timeout: 2500 });
    await tryClick(page, /update password/i);
    await page.waitForTimeout(600);
    await cap(page, key, "03-profile-pw-validation");
  } catch {
    /* ignore */
  }
}

async function mathJourney(page: Page, key: string) {
  await page.goto(`/math`);
  await cap(page, key, "10-math-landing");
  await page.goto(`/math/${MATH_COURSE}`);
  await cap(page, key, "11-math-hub");

  // Search (pgvector). Capture results, grab a keyword id for the lesson.
  let kw = "";
  try {
    const box = page.getByPlaceholder(/search/i).first();
    await box.fill("factoring quadratics", { timeout: 4000 });
    await box.press("Enter");
    await page.waitForTimeout(2500);
    await cap(page, key, "12-math-search");
    const href = await page.getByRole("link", { name: /lesson/i }).first().getAttribute("href").catch(() => null);
    if (href) kw = href.split("/").pop() ?? "";
  } catch {
    /* ignore */
  }

  // Category practice — exercise the QuestionToolbar.
  await page.goto(`/math/${MATH_COURSE}/${MATH_CATEGORY}/practice`);
  await cap(page, key, "13-math-practice");
  if (await tryClick(page, /quick refresher|refresher/i)) {
    await page.waitForTimeout(2500);
    await cap(page, key, "14-math-refresher");
  }
  await tryClick(page, /prioritize/i);
  await page.waitForTimeout(700);
  await cap(page, key, "15-math-prioritized");
  await answerMcq(page);
  await answerMcq(page);
  await cap(page, key, "16-math-after-answers");

  await page.goto(`/math/${MATH_COURSE}/${MATH_CATEGORY}/quiz`);
  await cap(page, key, "17-math-quiz");
  await answerMcq(page);
  await answerMcq(page);
  await cap(page, key, "18-math-quiz-progress");

  await page.goto(`/math/${MATH_COURSE}/practice`);
  await cap(page, key, "19-math-general-practice");

  if (kw) {
    await page.goto(`/math/lesson/${kw}`);
    await page.waitForTimeout(3000);
    await cap(page, key, "20-math-lesson");
  }

  await page.goto(`/math/${MATH_COURSE}/progress`);
  await cap(page, key, "21-math-progress");
}

async function mcatJourney(page: Page, key: string) {
  await page.goto(`/mcat`);
  await cap(page, key, "30-mcat-landing");

  let kw = "";
  try {
    const box = page.getByPlaceholder(/search/i).first();
    await box.fill("cellular respiration", { timeout: 4000 });
    await box.press("Enter");
    await page.waitForTimeout(2500);
    await cap(page, key, "31-mcat-search");
    const href = await page.getByRole("link", { name: /lesson/i }).first().getAttribute("href").catch(() => null);
    if (href) kw = href.split("/").pop() ?? "";
  } catch {
    /* ignore */
  }

  await page.goto(`/mcat/${MCAT_CATEGORY}`);
  await cap(page, key, "32-mcat-browse");

  await page.goto(`/mcat/${MCAT_CATEGORY}/practice`);
  await page.waitForTimeout(1500);
  await cap(page, key, "33-mcat-practice");
  if (await tryClick(page, /quick refresher|refresher/i)) {
    await page.waitForTimeout(2500);
    await cap(page, key, "34-mcat-refresher");
  }
  await tryClick(page, /prioritize/i);
  await page.waitForTimeout(700);
  await cap(page, key, "35-mcat-prioritized");
  await answerMcq(page);
  await answerMcq(page);
  await cap(page, key, "36-mcat-after-answers");

  await page.goto(`/mcat/${MCAT_CATEGORY}/quiz`);
  await page.waitForTimeout(1500);
  await cap(page, key, "37-mcat-quiz");
  await answerMcq(page);
  await cap(page, key, "38-mcat-quiz-progress");

  await page.goto(`/mcat/${MCAT_CATEGORY}/flashcards`);
  await page.waitForTimeout(1500);
  await cap(page, key, "39-mcat-flashcards");
  await page.locator("body").click({ position: { x: 400, y: 300 } }).catch(() => {});
  await page.waitForTimeout(600);
  await cap(page, key, "40-mcat-flashcard-back");
  await tryClick(page, /got it|missed it|i didn'?t know/i);
  await page.waitForTimeout(600);

  if (kw) {
    await page.goto(`/mcat/lesson/${kw}`);
    await page.waitForTimeout(3000);
    await cap(page, key, "41-mcat-lesson");
  }

  await page.goto(`/mcat/progress`);
  await cap(page, key, "42-mcat-progress");
}

test.describe.configure({ mode: "parallel" });

for (const p of PERSONAS) {
  test(`persona ${p.key} (${p.course})`, async ({ page }) => {
    test.setTimeout(15 * 60 * 1000);
    await login(page, p.key);

    // LONG extensive pass.
    await sharedSurfaces(page, p.key);
    if (p.course === "math") await mathJourney(page, p.key);
    else await mcatJourney(page, p.key);

    // SHORT pass — quick re-run of the core loop (fresh eyes, second visit).
    await page.goto("/");
    await cap(page, p.key, "90-short-home");
    if (p.course === "math") {
      await page.goto(`/math/${MATH_COURSE}/${MATH_CATEGORY}/practice`);
      await cap(page, p.key, "91-short-practice");
      await answerMcq(page);
      await cap(page, p.key, "92-short-after-answer");
    } else {
      await page.goto(`/mcat/${MCAT_CATEGORY}/flashcards`);
      await cap(page, p.key, "91-short-flashcards");
      await page.locator("body").click({ position: { x: 400, y: 300 } }).catch(() => {});
      await cap(page, p.key, "92-short-flashcard-back");
    }
  });
}
