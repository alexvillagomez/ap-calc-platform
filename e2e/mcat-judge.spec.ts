/**
 * MCAT Auto-Mode Student Judge v4
 * Persona: brand-new MCAT student, zero prior knowledge.
 * Goes through auto mode: flashcards → questions → mastery → next keyword → category.
 * Screenshots every piece, judges quality, appends to judge-mcat/REPORT.md.
 *
 * Run: E2E_BASE_URL=http://localhost:3002 npx playwright test mcat-judge --timeout=3600000
 *
 * Key fix from v3: ChoiceButton renders <span>A</span><span>text</span> — NO period/paren.
 * Old regex /^[A-D][.)]\s/ never matched. Now uses page.evaluate() badge-span detection.
 * Also: "I don't know" appears in BOTH flashcard and practice — removed it from flashcard detector.
 */

import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const SCREENSHOTS_DIR = path.join(process.cwd(), "judge-mcat", "screenshots");
const REPORT_PATH = path.join(process.cwd(), "judge-mcat", "REPORT.md");
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3002";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

let screenshotIdx = 0;
async function shot(page: Page, label: string): Promise<string> {
  screenshotIdx++;
  const filename = `${String(screenshotIdx).padStart(4, "0")}_${label.replace(/[^a-z0-9_]/gi, "_")}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  return filename;
}

function appendReport(section: string) {
  fs.appendFileSync(REPORT_PATH, section + "\n");
}

function log(msg: string) {
  console.log(`[JUDGE] ${msg}`);
}

async function signUpViaLoginGate(page: Page): Promise<string> {
  const ts = Date.now();
  const email = `judge${ts}@lodera-test.dev`;
  const username = `judge${ts}`;
  const password = "judgepass123";

  await page.goto(`${BASE_URL}/mcat/auto`);
  await page.waitForLoadState("domcontentloaded", { timeout: 20000 });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "0000_auth_gate.png"), fullPage: true });

  const signupBtn = page.locator('button').filter({ hasText: /^Sign up$/ }).first();
  await signupBtn.waitFor({ state: "visible", timeout: 15000 });
  await signupBtn.click();
  await page.waitForTimeout(800);

  await page.locator('#lg-email').first().fill(email);
  await page.waitForTimeout(200);
  await page.locator('#lg-username').first().fill(username);
  await page.waitForTimeout(200);
  await page.locator('#lg-password').first().fill(password);
  await page.waitForTimeout(200);

  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !document.querySelector('#lg-email'), { timeout: 30000 });
  await page.waitForTimeout(3000);
  log(`Signed up as ${username}`);
  return username;
}

async function getPageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText.slice(0, 3000));
}

// ── Choice-button detection via badge span (ChoiceButton renders <span>A</span><span>text</span>) ──

async function getChoiceCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).filter(btn => {
      const firstSpan = btn.querySelector("span");
      return firstSpan && /^[A-D]$/.test(firstSpan.textContent?.trim() ?? "");
    }).length;
  });
}

async function clickChoiceAtIndex(page: Page, idx: number): Promise<void> {
  await page.evaluate((i) => {
    const buttons = Array.from(document.querySelectorAll("button")).filter(btn => {
      const firstSpan = btn.querySelector("span");
      return firstSpan && /^[A-D]$/.test(firstSpan.textContent?.trim() ?? "");
    });
    if (buttons[i]) (buttons[i] as HTMLElement).click();
  }, idx);
}

// After answering, check if answer was correct by looking for green (✓) badge
async function wasLastAnswerCorrect(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll("button > span"));
    const hasCheck = spans.some(s => s.textContent?.trim() === "✓");
    const hasX = spans.some(s => s.textContent?.trim() === "✗");
    if (hasCheck) return true;
    if (hasX) return false;
    return null;
  });
}

function judgeContent(text: string, type: "flashcard" | "question" | "lesson" | "unknown") {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (text.includes("undefined") || text.includes("[object Object]")) {
    issues.push("BROKEN RENDER: 'undefined' or '[object Object]' visible");
  }
  if (text.match(/\\frac|\\theta|\\alpha|\\beta/) && !text.includes("$")) {
    issues.push("Raw LaTeX leaking — not rendered");
  }
  if (text.trim().length < 30) {
    issues.push("Content suspiciously short / possibly empty");
  }
  // Formatting checks for questions
  if (type === "question") {
    const stem = text.split("\n")[0] ?? "";
    if (stem.length > 10 && stem[0] === stem[0].toLowerCase() && stem[0].match(/[a-z]/)) {
      suggestions.push("Stem starts lowercase — should start with capital");
    }
    if (stem.length > 10 && !/[?.]$/.test(stem.trim())) {
      suggestions.push("Stem missing end punctuation (? or .)");
    }
  }
  if (type === "flashcard") {
    if (/\b(evaluate|calculate|solve|compute)\b/i.test(text)) {
      suggestions.push("Flashcard may be problem-solving — should be term/definition recall");
    }
  }

  return {
    verdict: issues.length === 0 ? "PASS" : issues.length === 1 ? "WARN" : "FAIL",
    issues,
    suggestions,
  };
}

// ─── Main Judge Test ───────────────────────────────────────────────────────────

test.describe("MCAT Auto-Mode Judge", () => {
  test.setTimeout(3_600_000);

  test("judge mcat auto mode end-to-end", async ({ page }) => {
    ensureDirs();
    appendReport(`\n## Session: ${new Date().toISOString()}\n`);

    const username = await signUpViaLoginGate(page);
    appendReport(`Signed up as **${username}**.\n`);
    await page.waitForTimeout(3000);

    const s0 = await shot(page, "01_auto_landing");
    const landingText = await getPageText(page);
    appendReport(`\n### Auto Mode First View\n- ${s0}\n- Preview: ${landingText.slice(0, 300)}\n`);
    log(`Landing: ${landingText.slice(0, 120)}`);

    let categoryCount = 0;
    let flashcardCount = 0;
    let questionCount = 0;
    let lessonCount = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let stuckCount = 0;
    let spinnerStuckCount = 0; // separate counter: spinner resets stuckCount but not this
    let iteration = 0;
    const MAX_ITERATIONS = 600;
    const MAX_STUCK = 12;
    const MAX_SPINNER_STUCK = 18; // ~90s of spinner → reload

    while (iteration < MAX_ITERATIONS) {
      iteration++;
      await page.waitForTimeout(800);

      const pageText = await getPageText(page);
      const pageTextLower = pageText.toLowerCase();

      // ── Terminal ──
      if (pageTextLower.includes("all categories mastered") || pageTextLower.includes("course complete")) {
        log("COMPLETE — all MCAT categories mastered!");
        const sf = await shot(page, "mcat_complete");
        appendReport(`\n### MCAT COMPLETE\n- ${sf}\n- fc=${flashcardCount}, q=${questionCount}, correct=${correctCount}/${questionCount}\n`);
        break;
      }

      // ── Content generating / loading spinner ──
      const spinnerVisible = await page.locator('.animate-spin').isVisible({ timeout: 300 }).catch(() => false);
      const generatingText = pageTextLower.includes("generating") || pageTextLower.includes("loading...");
      if (spinnerVisible || (generatingText && pageText.trim().length < 150)) {
        spinnerStuckCount++;
        log(`Iter ${iteration}: loading... (spinner #${spinnerStuckCount})`);
        if (spinnerStuckCount >= MAX_SPINNER_STUCK) {
          const ss = await shot(page, `spinner_reload_${iteration}`);
          appendReport(`\n#### Spinner reload (iter ${iteration})\n- ${ss}\n- Text: ${pageText.slice(0, 200)}\n`);
          log(`Spinner stuck ${spinnerStuckCount}x — reloading /mcat/auto`);
          await page.goto(`${BASE_URL}/mcat/auto`);
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(5000);
          spinnerStuckCount = 0;
          stuckCount = 0;
        } else {
          await page.waitForTimeout(5000);
          stuckCount = 0;
        }
        continue;
      }
      spinnerStuckCount = 0; // reset when spinner is gone

      // ── Category complete / checkpoint / transition ──
      const catDone =
        pageTextLower.includes("category complete") ||
        pageTextLower.includes("checkpoint quiz") ||
        pageTextLower.includes("all keywords mastered") ||
        pageTextLower.includes("moving to next");
      if (catDone) {
        categoryCount++;
        const sc = await shot(page, `cat_complete_${categoryCount}`);
        appendReport(`\n### Category ${categoryCount} Complete\n- ${sc}\n`);
        log(`Category ${categoryCount} complete`);
        const acted = await page.locator('button:has-text("Continue"), button:has-text("Next category"), button:has-text("Skip quiz"), button:has-text("Take quiz")').first().click().then(() => true).catch(() => false);
        if (acted) { stuckCount = 0; await page.waitForTimeout(2000); }
        continue;
      }

      // ── Flashcard FRONT (has "Show answer" button) ──
      const showAnswerBtn = page.locator('button:has-text("Show answer")').first();
      const showAnswerVisible = await showAnswerBtn.isVisible({ timeout: 300 }).catch(() => false);
      if (showAnswerVisible) {
        flashcardCount++;
        stuckCount = 0;
        const sf = await shot(page, `fc_${flashcardCount}`);
        const judge = judgeContent(pageText, "flashcard");
        if (flashcardCount <= 6 || flashcardCount % 10 === 0 || judge.verdict !== "PASS") {
          appendReport(`\n#### Flashcard #${flashcardCount} [${judge.verdict}]\n- ${sf}\n- Issues: ${judge.issues.join("; ") || "none"}\n- Suggestions: ${judge.suggestions.join("; ") || "none"}\n- Preview: ${pageText.slice(0, 280)}\n`);
        }
        log(`FC front #${flashcardCount}: ${judge.verdict} — ${pageText.slice(0, 80)}`);
        await showAnswerBtn.click();
        await page.waitForTimeout(1500);
        await shot(page, `fc_${flashcardCount}_back`);
        // Click "Got it" 70%, "Almost" 20%, "I don't know" 10%
        const r = Math.random();
        if (r < 0.7) {
          await page.locator('button:has-text("Got it"), button:has-text("I knew it"), button:has-text("Easy")').first().click().catch(() => {});
        } else if (r < 0.9) {
          await page.locator('button:has-text("Almost"), button:has-text("Hard")').first().click().catch(() => {});
        } else {
          await page.locator('button:has-text("I don\'t know"), button:has-text("Again")').first().click().catch(() => {});
        }
        await page.waitForTimeout(1200);
        continue;
      }

      // ── Flashcard BACK already revealed (Got it / Almost visible, no Show answer) ──
      const gotItVisible = await page.locator('button:has-text("Got it"), button:has-text("I knew it")').first().isVisible({ timeout: 300 }).catch(() => false);
      if (gotItVisible) {
        stuckCount = 0;
        await page.locator('button:has-text("Got it"), button:has-text("I knew it")').first().click().catch(() => {});
        await page.waitForTimeout(1200);
        continue;
      }

      // ── Practice question (unanswered): detect via ChoiceButton badge spans A/B/C/D ──
      const numChoices = await getChoiceCount(page);
      const continueVisible = await page.locator('button:has-text("Continue")').first().isVisible({ timeout: 300 }).catch(() => false);

      if (numChoices >= 2 && !continueVisible) {
        questionCount++;
        stuckCount = 0;
        const sq = await shot(page, `q_${questionCount}`);
        const judge = judgeContent(pageText, "question");

        if (questionCount <= 8 || questionCount % 10 === 0 || judge.verdict !== "PASS") {
          appendReport(`\n#### Question #${questionCount} [${judge.verdict}]\n- ${sq}\n- Issues: ${judge.issues.join("; ") || "none"}\n- Suggestions: ${judge.suggestions.join("; ") || "none"}\n- Preview: ${pageText.slice(0, 350)}\n`);
        }
        log(`Q #${questionCount}: ${judge.verdict} — ${pageText.slice(0, 100)}`);

        // Pick a choice (uniform random across A/B/C/D)
        const idx = Math.floor(Math.random() * Math.min(numChoices, 4));
        await clickChoiceAtIndex(page, idx);
        await page.waitForTimeout(2500);

        // Check correct/wrong
        const correct = await wasLastAnswerCorrect(page);
        if (correct === true) correctCount++;
        else if (correct === false) incorrectCount++;

        await shot(page, `q_${questionCount}_answered`);

        // Click Continue
        await page.locator('button:has-text("Continue")').first().click().catch(() => {});
        await page.waitForTimeout(2000);
        continue;
      }

      // ── Practice revealed (waiting for Continue after a correct/wrong answer) ──
      if (continueVisible) {
        stuckCount = 0;
        await page.locator('button:has-text("Continue")').first().click();
        await page.waitForTimeout(2000);
        continue;
      }

      // ── Lesson (triggered on struggle: "Start lesson" offer or inline LessonView) ──
      const lessonVisible =
        pageTextLower.includes("next step") ||
        pageTextLower.includes("step 1") ||
        (await page.locator('button:has-text("Next Step")').isVisible({ timeout: 300 }).catch(() => false)) ||
        (await page.locator('button:has-text("Got it! Next step")').isVisible({ timeout: 300 }).catch(() => false));
      if (lessonVisible) {
        lessonCount++;
        stuckCount = 0;
        const sl = await shot(page, `lesson_${lessonCount}`);
        if (lessonCount <= 4 || lessonCount % 5 === 0) {
          appendReport(`\n#### Lesson #${lessonCount}\n- ${sl}\n- Preview: ${pageText.slice(0, 350)}\n`);
        }
        log(`Lesson #${lessonCount}: ${pageText.slice(0, 80)}`);

        let steps = 0;
        while (steps < 30) {
          steps++;
          const advanced = await page.locator('button:has-text("Next Step"), button:has-text("Got it! Next step"), button:has-text("Got it"), button:has-text("Continue")').first().click().then(() => true).catch(() => false);
          if (!advanced) break;
          await page.waitForTimeout(1000);
          // Stop if new content type detected
          const newChoices = await getChoiceCount(page);
          const newFlashcard = await page.locator('button:has-text("Show answer")').isVisible({ timeout: 200 }).catch(() => false);
          if (newChoices >= 2 || newFlashcard) break;
        }
        await page.waitForTimeout(1500);
        continue;
      }

      // ── Start lesson offer ("Start lesson" / "Keep going" buttons) ──
      const startLessonVisible = await page.locator('button:has-text("Start lesson")').isVisible({ timeout: 300 }).catch(() => false);
      if (startLessonVisible) {
        stuckCount = 0;
        // Skip the lesson offer 60% — keep practicing
        if (Math.random() < 0.6) {
          await page.locator('button:has-text("Keep going")').first().click().catch(() => {});
        } else {
          await page.locator('button:has-text("Start lesson")').first().click().catch(() => {});
        }
        await page.waitForTimeout(1500);
        continue;
      }

      // ── Start / Begin ──
      const startActed = await page.locator('button:has-text("Start"), button:has-text("Begin"), button:has-text("Start learning")').first().click().then(() => true).catch(() => false);
      if (startActed) { stuckCount = 0; await page.waitForTimeout(2000); continue; }

      // ── Stuck handler ──
      stuckCount++;
      log(`Iter ${iteration}: stuck (${stuckCount}), numChoices=${numChoices}, text="${pageText.slice(0, 100)}"`);

      if (stuckCount >= MAX_STUCK) {
        const sst = await shot(page, `stuck_${iteration}`);
        appendReport(`\n#### Stuck reload (iter ${iteration})\n- ${sst}\n- Text: ${pageText.slice(0, 250)}\n`);
        log(`Stuck ${stuckCount}x — reloading /mcat/auto`);
        await page.goto(`${BASE_URL}/mcat/auto`);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(5000);
        stuckCount = 0;
      } else {
        await page.waitForTimeout(3000);
      }

      // ── Periodic report ──
      if (iteration % 25 === 0) {
        const acc = questionCount > 0 ? Math.round(correctCount / questionCount * 100) : 0;
        appendReport(`\n### Progress (iter ${iteration})\n- fc=${flashcardCount}, q=${questionCount}, correct=${correctCount}/${questionCount} (${acc}%), lessons=${lessonCount}, cats=${categoryCount}\n`);
        log(`Progress: iter=${iteration}, fc=${flashcardCount}, q=${questionCount}, correct=${correctCount}, acc=${acc}%, cats=${categoryCount}`);
      }
    }

    // ── Final summary ──
    const sfinal = await shot(page, "final_state");
    const acc = questionCount > 0 ? Math.round(correctCount / questionCount * 100) : 0;
    appendReport(`\n## Final Summary (iter ${iteration})\n- Flashcards: ${flashcardCount}\n- Questions: ${questionCount} (${acc}% correct)\n- Lessons: ${lessonCount}\n- Categories: ${categoryCount}\n- ${sfinal}\n`);
    log(`Done. fc=${flashcardCount}, q=${questionCount}, correct=${correctCount}/${questionCount} (${acc}%), cats=${categoryCount}`);
    expect(iteration).toBeGreaterThan(0);
  });
});
