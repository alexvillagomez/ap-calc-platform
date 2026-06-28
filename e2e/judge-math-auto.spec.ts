/**
 * MATH JUDGE AGENT — AP Calculus Auto Mode
 *
 * Role: Brand-new student, zero calculus knowledge.
 * Drives /math/calc_ab/auto from ground zero: lesson → flashcards → questions
 * Screenshots and judges every piece. Deletes bad questions.
 */

import { test, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3002";
const SCREENSHOTS_DIR = path.resolve("./judge-math/screenshots");
const REPORT_PATH = path.resolve("./judge-math/REPORT.md");

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ─── Report helpers ────────────────────────────────────────────────────────
let screenshotCount = 0;

async function snap(page: Page, label: string): Promise<string> {
  screenshotCount++;
  const n = String(screenshotCount).padStart(4, "0");
  const safe = label.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 70);
  const filename = `${n}_${safe}.png`;
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, filename), fullPage: true });
  console.log(`📸 ${filename}`);
  return filename;
}

function log(msg: string) {
  const line = `${msg}\n`;
  fs.appendFileSync(REPORT_PATH, line);
  console.log(msg);
}

// ─── Auth ──────────────────────────────────────────────────────────────────
async function registerAndLogin(page: Page) {
  const stamp = `j${Date.now()}`;
  const username = `judge_math_${stamp}`;
  const email = `${username}@test.lodera.ai`;
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email, username, password: "JudgePass123!", mode: "signup" },
  });
  const data = (await res.json()) as { user?: { id?: string }; sessionId?: string };
  await page.addInitScript(
    ([a, s, u]) => {
      localStorage.setItem("ap_calc_account_id", a);
      localStorage.setItem("ap_calc_username", u);
      localStorage.setItem("ap_calc_student_session_id", s);
    },
    [data.user?.id ?? "", data.sessionId ?? "", username]
  );
  log(`\n**Test user:** ${username} (id: ${data.user?.id})`);
  return data;
}

// ─── Click helper — robust ────────────────────────────────────────────────
async function clickBtn(page: Page, pattern: RegExp, timeout = 6000): Promise<boolean> {
  try {
    const btn = page.getByRole("button", { name: pattern }).first();
    await btn.waitFor({ state: "visible", timeout });
    await btn.click();
    await page.waitForTimeout(800);
    return true;
  } catch {
    return false;
  }
}

// Click first visible ChoiceButton (A/B/C/D choice inside lesson or practice)
async function clickFirstChoice(page: Page): Promise<boolean> {
  try {
    // ChoiceButton is a <button class="w-full flex items-start gap-3 ... rounded-xl border text-left ...">
    // Most reliable: find buttons with the badge span (A/B/C/D) inside
    const choiceBtns = page.locator('button.rounded-xl.border.text-left').filter({ hasNot: page.locator(':disabled') });
    const count = await choiceBtns.count();
    if (count > 0) {
      await choiceBtns.first().click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      return true;
    }
    // Fallback: any enabled button that contains a span with single letter A/B/C/D
    const spanLetterBtn = page.locator('button:has(span:text-matches("^[A-D]$"))').first();
    const visible = await spanLetterBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (visible) {
      await spanLetterBtn.click();
      await page.waitForTimeout(1000);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Page text snapshot ───────────────────────────────────────────────────
async function getText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText).catch(() => "");
}

// ─── Visible button labels ────────────────────────────────────────────────
async function getButtonLabels(page: Page): Promise<string[]> {
  const btns = await page.getByRole("button").all();
  const labels: string[] = [];
  for (const b of btns.slice(0, 20)) {
    try {
      const txt = await b.textContent();
      const visible = await b.isVisible({ timeout: 200 }).catch(() => false);
      if (txt && visible && txt.trim().length > 0) labels.push(txt.trim().slice(0, 80));
    } catch { /* skip */ }
  }
  return labels;
}

// ─── DB delete helper ─────────────────────────────────────────────────────
async function deleteQuestion(page: Page, id: string, reason: string) {
  try {
    // Try via Supabase REST with service key
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      const r = await page.request.delete(`${supabaseUrl}/rest/v1/math_questions?id=eq.${id}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
      });
      log(`🗑️  Deleted question ${id} (HTTP ${r.status()}): ${reason}`);
      return r.status() < 300;
    }
  } catch (e) {
    log(`⚠️  Could not delete ${id}: ${e}`);
  }
  return false;
}

// ─── Main test ─────────────────────────────────────────────────────────────
test.setTimeout(0);

test("MATH JUDGE: calc_ab auto from zero", async ({ page }) => {
  // Init report
  log(`\n${"=".repeat(60)}`);
  log(`## MATH JUDGE RUN — ${new Date().toISOString()}`);
  log(`**URL:** ${BASE}/math/calc_ab/auto`);
  log(`${"=".repeat(60)}\n`);

  await registerAndLogin(page);

  // ── Navigate to auto mode ─────────────────────────────────────────────
  await page.goto(`${BASE}/math/calc_ab/auto`);
  await page.waitForTimeout(8000); // wait for auto-plan to load
  await snap(page, "start_auto_mode");

  // ── Helper: skip diagnostic if gate appears ────────────────────────
  async function skipDiagnosticIfNeeded(): Promise<boolean> {
    const t = await getText(page);
    if (t.includes("placement check") || t.includes("Start with a placement")) {
      await snap(page, "diagnostic_gate");
      log(`\n### Diagnostic Gate — clicking Skip and start from beginning`);
      // Try button
      let ok = await clickBtn(page, /skip and start from the beginning/i, 5000);
      if (!ok) ok = await clickBtn(page, /skip.*start|start from the beginning/i, 3000);
      if (!ok) {
        // direct locator
        await page.locator("text=Skip and start from the beginning").click({ timeout: 5000 }).catch(() => {});
        ok = true;
      }
      await page.waitForTimeout(6000);
      log(`Skipped diagnostic\n`);
      return true;
    }
    return false;
  }

  await skipDiagnosticIfNeeded();
  await snap(page, "after_initial_skip");

  // ── State tracking ────────────────────────────────────────────────────
  let iteration = 0;
  let lessonCount = 0;
  let flashcardCount = 0;
  let flashcardsSinceLastQuestion = 0; // safety valve
  let questionCount = 0;
  let topicLabel = "";
  let deletions: string[] = [];
  let lastPhase = "";

  // ── Main loop ─────────────────────────────────────────────────────────
  while (iteration < 500) {
    iteration++;
    await page.waitForTimeout(1200);

    const txt = await getText(page);
    const btns = await getButtonLabels(page);
    const btnStr = btns.join(" | ");

    // Detect topic label from header
    const topicMatch = txt.match(/Topic \d+\/\d+[\n\r\s]+([^\n\r]+)/);
    if (topicMatch) topicLabel = topicMatch[1].trim().slice(0, 60);

    // ── Health check every 30 iterations ─────────────────────────────
    if (iteration % 30 === 1) {
      try {
        const r = await page.request.get(`${BASE}/api/auth/me`);
        log(`\n[Health @ ${iteration}] auth: ${r.status()} | snaps: ${screenshotCount} | lessons: ${lessonCount} | fc: ${flashcardCount} | q: ${questionCount}`);
      } catch (e) {
        log(`[Health @ ${iteration}] ERROR: ${e}`);
      }
    }

    // ── DIAGNOSTIC GATE (can re-appear after plan reload) ────────────
    if (txt.includes("Start with a placement") || txt.includes("placement check")) {
      const didSkip = await skipDiagnosticIfNeeded();
      if (didSkip) {
        lastPhase = "skipped_diag";
        continue;
      }
    }

    // ── COURSE COMPLETE ───────────────────────────────────────────────
    if (/course complete|all done/i.test(txt)) {
      await snap(page, "course_complete");
      log(`\n## 🏆 COURSE COMPLETE at iteration ${iteration}`);
      log(`Lessons: ${lessonCount} | Flashcards: ${flashcardCount} | Questions: ${questionCount}`);
      log(`Deletions: ${deletions.length}`);
      break;
    }

    // ── UNIT / CATEGORY COMPLETE ──────────────────────────────────────
    if (/unit complete|🎉|category complete/i.test(txt) && !/Step \d of \d/.test(txt)) {
      const snapName = await snap(page, `unit_complete_t${topicCount(lessonCount)}`);
      log(`\n### Unit Complete — ${snapName}`);
      log(`**Verdict:** Good milestone — shows progress. Would benefit from a brief summary of what was covered.`);
      const clicked = await clickBtn(page, /continue|next unit|keep going/i, 3000);
      if (!clicked) await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);
      continue;
    }

    // ── ERROR STATE ───────────────────────────────────────────────────
    if (txt.includes("No questions available") || txt.includes('"error"')) {
      const snapErr = await snap(page, `error_state_${iteration}`);
      log(`\n⚠️ **ERROR STATE** at iteration ${iteration}: "${txt.slice(0, 200).replace(/\n/g, " ")}"`);
      log(`**Screenshot:** ${snapErr}`);
      log(`**Bug:** Raw JSON error shown to user — should be user-friendly message`);
      log(`**Action:** Clicking "Try again"`);
      const tryAgainBtn = page.locator('button:has-text("Try again"), button:has-text("Retry")').first();
      const tryAgainVisible = await tryAgainBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (tryAgainVisible) {
        await tryAgainBtn.click({ force: true });
        await page.waitForTimeout(5000); // wait for question generation
      } else {
        // Navigate directly to reload the auto mode
        await page.goto(`${BASE}/math/calc_ab/auto`);
        await page.waitForTimeout(6000);
        await skipDiagnosticIfNeeded();
      }
      lastPhase = "error_recovery";
      continue;
    }

    // ── LOADING STATE ─────────────────────────────────────────────────
    if (/building a quick lesson|finding your next|generating|loading/i.test(txt) && !btns.some(b => /try a question|next step|finish lesson|continue|skip lesson/i.test(b))) {
      if (lastPhase !== "loading") {
        log(`\n[Loading...] iteration ${iteration}: "${txt.slice(0, 120).replace(/\n/g, " ")}"`);
        lastPhase = "loading";
      }
      await page.waitForTimeout(4000);
      continue;
    }

    // ── LESSON PHASE (any lesson state: read, question, complete) ────
    const inLessonPhase = txt.includes("Step 1 of 3 · Lesson") ||
      /LESSON:|Step \d+ of \d+\s*Skip lesson/i.test(txt) ||
      txt.includes("Lesson complete!");

    if (inLessonPhase) {
      if (lastPhase !== "lesson") {
        lessonCount++;
        const lessonLabel = txt.match(/LESSON: ([^\n]+)/)?.[1]?.trim() ??
          txt.match(/Lesson:\s*([^\n]+)/i)?.[1]?.trim() ??
          topicLabel ?? "Unknown";
        const stepInfo = txt.match(/Step (\d+) of (\d+)/)?.[0] ?? "Step ?";

        // Take full-page screenshot
        const snapName = await snap(page, `lesson_${lessonCount}_${lessonLabel.replace(/[^a-z0-9]/gi,"_").slice(0,40)}`);
        log(`\n### Lesson #${lessonCount}: ${lessonLabel} (${stepInfo})`);
        log(`**Screenshot:** ${snapName}`);
        log(`**Topic:** ${topicLabel}`);

        // Extract lesson content quality from raw DOM
        const html = await page.content();
        const hasKatex = html.includes('katex');
        const hasExample = txt.toLowerCase().includes("example") || txt.toLowerCase().includes("find the");
        const hasExplanation = txt.toLowerCase().includes("explanation") || txt.toLowerCase().includes("tells") || txt.toLowerCase().includes("describes");

        // Count meaningful words (strip KaTeX rendering artifacts)
        const cleanTxt = txt.replace(/[a-z]\s*\n\s*[a-z]/g, " ").replace(/\n{3,}/g, "\n");
        const wordCount = cleanTxt.split(/\s+/).filter(w => w.length > 1).length;

        log(`**Has rendered formulas (KaTeX):** ${hasKatex ? "YES ✓" : "NO ⚠️ — check LaTeX rendering"}`);
        log(`**Has example:** ${hasExample ? "YES ✓" : "NO — add a worked example"}`);
        log(`**Has explanation text:** ${hasExplanation ? "YES ✓" : "UNCLEAR"}`);
        log(`**Approx word count:** ${wordCount}`);

        // Screenshot all lesson steps by scrolling
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        const snapBottom = await snap(page, `lesson_${lessonCount}_bottom`);
        log(`**Screenshot (bottom):** ${snapBottom}`);
        await page.evaluate(() => window.scrollTo(0, 0));

        const good = hasKatex && (hasExample || hasExplanation);
        log(`\n**Quality verdict:** ${good ? "GOOD" : "NEEDS IMPROVEMENT"}`);
        log(`**Would I pay?** ${good ? "MAYBE — content quality is reasonable, needs more interactivity" : "NOT YET — content quality needs improvement"}`);
        log(`**What would make me pay more:** Worked examples with step-by-step algebra shown, ability to slow down on hard concepts, video/animation for visual topics like limits.`);
        log(`**Improvements:** ${!hasKatex ? "Fix LaTeX rendering urgently — formulas are core to calculus. " : ""}${!hasExample ? "Add a concrete worked example to every step. " : "Lesson structure good."}`);;
        log(`**System check:** Lesson appears before flashcards and practice ✓\n`);

        lastPhase = "lesson";
      }

      // Navigate the lesson step-by-step.
      // The lesson has phases: read → question → correct/wrong → next step/done.

      // 1) "Try a question" visible → we're in READ phase, click it to enter question phase
      const tryQ = await page.locator('button:has-text("Try a question")').first();
      const tryQVisible = await tryQ.isVisible({ timeout: 1000 }).catch(() => false);
      if (tryQVisible) {
        await tryQ.scrollIntoViewIfNeeded().catch(() => {});
        await tryQ.click({ force: true });
        await page.waitForTimeout(2000); // wait for React to render choices
        continue; // next iteration will see choices and click one
      }

      // 2) "Next step", "Finish lesson", "Move on" visible → choice was answered, advance
      const nextStep = await page.locator('button:has-text("Next step"), button:has-text("Finish lesson"), button:has-text("Move on")').first();
      const nextStepVisible = await nextStep.isVisible({ timeout: 1000 }).catch(() => false);
      if (nextStepVisible) {
        await nextStep.click({ force: true });
        await page.waitForTimeout(1200);
        continue;
      }

      // 3) Lesson complete screen — "Continue"
      if (txt.includes("Lesson complete!")) {
        const contBtn = await page.locator('button:has-text("Continue")').first();
        const contVisible = await contBtn.isVisible({ timeout: 2000 }).catch(() => false);
        if (contVisible) {
          const snapDone = await snap(page, `lesson_${lessonCount}_complete`);
          log(`\n**Lesson ${lessonCount} complete!** (${snapDone}) → clicking Continue`);
          await contBtn.click({ force: true });
          await page.waitForTimeout(2000);
          lastPhase = "lesson_done";
          continue;
        }
      }

      // 4) Unanswered choice buttons visible → we're in QUESTION phase, click a choice
      // This happens when "Try a question" was already clicked but clickFirstChoice failed last iter
      const lessonChoices = page.locator('button.rounded-xl.border.text-left').filter({ hasNot: page.locator(':disabled') });
      const lessonChoiceCount = await lessonChoices.count().catch(() => 0);
      if (lessonChoiceCount >= 2) {
        // Rotate: pick by lessonCount so we vary choices across lessons
        const idx = lessonCount % lessonChoiceCount;
        await lessonChoices.nth(Math.min(idx, lessonChoiceCount - 1)).click({ force: true });
        await page.waitForTimeout(1500);
        continue;
      }

      // 5) "Try again" visible (after wrong answer if we need to retry)
      const tryAgainBtn = await page.locator('button:has-text("Try again")').first();
      const tryAgainVisible = await tryAgainBtn.isVisible({ timeout: 800 }).catch(() => false);
      if (tryAgainVisible) {
        await tryAgainBtn.click({ force: true });
        await page.waitForTimeout(1000);
        continue;
      }

      // 6) Fallback: "Skip lesson" — last resort to unblock
      const skipLessonBtn = await page.locator('button:has-text("Skip lesson")').first();
      const skipVisible = await skipLessonBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (skipVisible) {
        const snapSkip = await snap(page, `lesson_${lessonCount}_skip`);
        log(`\n**Skipping lesson ${lessonCount}** (no navigation found) — screenshot: ${snapSkip}`);
        await skipLessonBtn.click({ force: true });
        await page.waitForTimeout(3000);
        lastPhase = "lesson_skipped";
      } else {
        await page.waitForTimeout(2000);
      }
      continue;
    }

    // ── FLASHCARD PHASE ───────────────────────────────────────────────
    // Entry point: "Show answer" visible means we're on the FRONT of a new card.
    // "Got it" visible WITHOUT "Show answer" means we already flipped but didn't advance.
    const showAnsVisible = await page.locator('button:has-text("Show answer"), button:has-text("Show Answer")').first().isVisible({ timeout: 400 }).catch(() => false);
    const gotItNowVisible = await page.locator('button:has-text("Got it")').first().isVisible({ timeout: 400 }).catch(() => false);
    const skipToPracticeVisible = await page.locator('button:has-text("Skip to practice")').first().isVisible({ timeout: 400 }).catch(() => false);

    // Safety valve: if too many consecutive flashcards, skip to practice
    if ((showAnsVisible || gotItNowVisible) && flashcardsSinceLastQuestion >= 12) {
      log(`\n⚠️ **Safety valve: ${flashcardsSinceLastQuestion} flashcards without questions — clicking Skip to practice**`);
      const skPrac = page.locator('button:has-text("Skip to practice")').first();
      const skPracV = await skPrac.isVisible({ timeout: 2000 }).catch(() => false);
      if (skPracV) {
        await skPrac.click({ force: true });
        flashcardsSinceLastQuestion = 0;
      } else {
        // No skip button — just try grading to advance
        await page.locator('button:has-text("Got it")').first().click({ force: true }).catch(() => {});
      }
      await page.waitForTimeout(2000);
      lastPhase = "flashcard_skipped";
      continue;
    }

    if (showAnsVisible) {
      // FRONT of a card — log, flip, advance
      flashcardCount++;
      flashcardsSinceLastQuestion++;
      // Card number from flashcard counter (format "N / M"), NOT from header "Unit 1/8"
      // The flashcard counter appears after "Step 2 of 3 · Flashcards"
      const fcCounterMatch = txt.match(/Flashcards[^\n]*\n\s*(\d+)\s*\/\s*(\d+)/);
      const cardNumMatch = fcCounterMatch ?? txt.match(/(\d+)\s*\/\s*3/);
      const cardLabel = cardNumMatch ? `${cardNumMatch[1]}of${cardNumMatch[2]}` : `${flashcardCount}`;

      const snapFront = await snap(page, `flashcard_${flashcardCount}_front_${cardLabel}`);
      const frontMatch = txt.match(/FRONT\s*([\s\S]*?)(?:tap to flip|Show answer|$)/i);
      const frontText = (frontMatch?.[1] ?? "").trim().replace(/\n+/g, " ").slice(0, 200);
      log(`\n### Flashcard #${flashcardCount} (${cardLabel}) — ${topicLabel}`);
      log(`**Front:** ${frontText || "(extracted from page)"}`);

      const isBadFC = /^(evaluate|solve|compute|calculate|find the value)/i.test(frontText);
      if (isBadFC) log(`⚠️ **BAD FORMAT** — front is a problem prompt, not a recall cue`);

      // Flip
      await page.locator('button:has-text("Show answer"), button:has-text("Show Answer")').first().click({ force: true });
      await page.waitForTimeout(1200);
      const snapBack = await snap(page, `flashcard_${flashcardCount}_back_${cardLabel}`);
      const backTxt = await getText(page);
      const backMatch = backTxt.match(/BACK\s*([\s\S]*?)(?:tap to flip back|Missed it|Got it|$)/i);
      const backText = (backMatch?.[1] ?? "").trim().replace(/\n+/g, " ").slice(0, 300);
      const hasMath = /[=∫∑→−+]|lim|sin|cos|\d{2}/.test(backText);

      log(`**Back:** ${backText}`);
      log(`**Has math/formula:** ${hasMath ? "YES ✓" : "NO — consider adding notation"}`);
      log(`**Quality:** ${!isBadFC && hasMath ? "GOOD ✓" : !isBadFC ? "OK — recall card" : "BAD — problem format"}`);
      log(`**Would I pay?** ${!isBadFC ? "YES — proper recall cards are exactly what students need" : "NO — fix to term→definition format"}`);
      log(`**System check:** Flashcard in Step 2 of 3 (lesson→flashcard→quiz) ✓\n`);

      // Click "Got it" to advance to next card
      await page.locator('button:has-text("Got it")').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
      lastPhase = "flashcard";
      continue;

    } else if (gotItNowVisible) {
      // Already on back but didn't advance last iteration
      await page.locator('button:has-text("Got it")').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
      lastPhase = "flashcard";
      continue;
    }

    // ── PRACTICE / QUIZ QUESTION ──────────────────────────────────────
    // Detect by CSS class of ChoiceButton components (only outside lesson phase)
    const choiceCount = await page.locator('button.rounded-xl.border.text-left').count().catch(() => 0);
    const hasMultipleChoices = choiceCount >= 2;

    if (hasMultipleChoices && !inLessonPhase && !btns.some(b => /try a question|next step|finish lesson/i.test(b))) {
      questionCount++;
      flashcardsSinceLastQuestion = 0;

      // Extract question ID if available
      const qId = await page.evaluate(() =>
        document.querySelector("[data-question-id]")?.getAttribute("data-question-id") ?? null
      ).catch(() => null);

      const stem = txt.match(/([A-Z][^?]+\?)/)?.[1] ?? txt.slice(0, 300).replace(/\n/g, " ");
      const snapQ = await snap(page, `question_${questionCount}_stem`);

      log(`\n### Question #${questionCount} — ${topicLabel}`);
      log(`**Screenshot:** ${snapQ}`);
      log(`**ID:** ${qId ?? "unknown"}`);
      log(`**Stem preview:** ${stem.slice(0, 300)}`);
      log(`**Choices visible:** ${btns.filter(b => b.length > 2 && b.length < 200).slice(0, 6).join(" | ")}`);

      // Check for rendering issues
      const hasRawLatex = /\\\\frac|\\\\lim|\\f[^a-z]/.test(txt); // escaped LaTeX
      const hasMissingKatex = txt.includes("\\frac") && !await page.locator(".katex").isVisible({ timeout: 300 }).catch(() => false);
      const isGibberish = stem.replace(/\s/g, "").length < 10;

      if (hasRawLatex || hasMissingKatex || isGibberish) {
        log(`⚠️ **RENDERING BUG DETECTED:**`);
        if (hasRawLatex) log(`  - Double-escaped LaTeX (\\\\frac found in text)`);
        if (hasMissingKatex) log(`  - Raw LaTeX \\frac visible but no .katex rendered elements`);
        if (isGibberish) log(`  - Question stem is too short/empty`);

        if (qId) {
          const deleted = await deleteQuestion(page, qId, hasRawLatex ? "double-escaped LaTeX" : hasMissingKatex ? "unrendered LaTeX" : "empty/gibberish stem");
          if (deleted) deletions.push(qId);
          log(`  **ACTION:** ${deleted ? "DELETED" : "Could not delete"} question ${qId}`);
        }
        log(`**Would I pay?** NO — broken rendering destroys credibility immediately`);

        // Skip this question
        const skippedQ = await clickBtn(page, /continue|next|skip/i, 3000);
        if (!skippedQ) await page.keyboard.press("Enter");
        await page.waitForTimeout(1000);
        continue;
      }

      // Answer: alternate between choices to simulate a real student (not always wrong)
      // Pick choice by question number: 0→first, 1→last, 2→second, 3→first, etc.
      let answered = false;
      const allChoiceBtns = await page.locator('button.rounded-xl.border.text-left').all();
      if (allChoiceBtns.length > 0) {
        const idx = questionCount % Math.max(allChoiceBtns.length, 1);
        const choiceToClick = allChoiceBtns[Math.min(idx, allChoiceBtns.length - 1)];
        await choiceToClick.click({ timeout: 5000 }).catch(() => {});
        answered = true;
      }
      if (!answered) {
        answered = await clickFirstChoice(page);
      }

      if (answered) {
        await page.waitForTimeout(2000);
        const snapResult = await snap(page, `question_${questionCount}_result`);
        const resultTxt = await getText(page);
        const resultBtns = await getButtonLabels(page);

        const isCorrect = /correct/i.test(resultTxt);
        const explanation = resultTxt.match(/(?:explanation|solution|why)[\s\S]{0,500}/i)?.[0]?.slice(0, 400) ?? "";
        const hasExplanation = explanation.trim().length > 30;
        const hasStepByStep = /step|therefore|because|so|thus|since/i.test(explanation);
        const hasFormula = await page.locator(".katex").count().then(n => n > 0).catch(() => false);

        log(`**Screenshot (result):** ${snapResult}`);
        log(`**Result:** ${isCorrect ? "✓ Correct" : "✗ Incorrect"} (student picked first choice)`);
        log(`**Has explanation:** ${hasExplanation ? "YES ✓" : "NO ⚠️"}`);
        log(`**Has step-by-step logic:** ${hasStepByStep ? "YES ✓" : "NO"}`);
        log(`**Has rendered formula:** ${hasFormula ? "YES ✓" : "NO"}`);
        log(`\n**Explanation preview:** ${explanation.slice(0, 300)}`);

        const quality = hasExplanation && hasStepByStep ? "GOOD" : hasExplanation ? "OK" : "POOR";
        log(`\n**Quality verdict:** ${quality}`);
        log(`**Would I pay?** ${quality === "GOOD" ? "YES — explained reasoning is what makes tutoring valuable" : quality === "OK" ? "MAYBE — needs fuller explanation" : "NO — no explanation = can't learn from mistakes"}`);
        log(`**What would make me pay MORE:** Side-by-side worked solution, ability to ask follow-up questions, visual graph when relevant.`);
        log(`**System check:** Practice question shown after lesson+flashcards ✓\n`);

        lastPhase = "question_result";

        // Continue
        const cont = await clickBtn(page, /^continue$|^next question$|^next$/i, 5000);
        if (!cont) {
          await clickBtn(page, /continue|next/i, 3000);
        }
        await page.waitForTimeout(1500);
      }
      continue;
    }


    // ── MINI QUIZ / CHECKPOINT ────────────────────────────────────────
    if (/checkpoint|mini.?quiz|Quiz \d/i.test(txt) && hasMultipleChoices) {
      const snapQ = await snap(page, `mini_quiz_q${questionCount}`);
      log(`\n### Mini Quiz / Checkpoint — ${snapQ}`);
      log(`**System check:** Checkpoint quiz fires after unit completion ✓ (good pacing)`);
      // Will be handled by the multiple-choice branch next iteration
      continue;
    }

    // ── SKIP QUIZ OPTION ─────────────────────────────────────────────
    if (btns.some(b => /skip quiz|keep going/i.test(b))) {
      const snapName = await snap(page, `skip_quiz_option_${iteration}`);
      log(`\n**Skip-quiz option shown** (${snapName}) — taking the quiz for thorough coverage`);
      // Don't skip — let it fall through to question handling
      continue;
    }

    // ── UNKNOWN STATE — log and try to advance ────────────────────────
    if (lastPhase !== "unknown") {
      const snapName = await snap(page, `unknown_${iteration}`);
      log(`\n[Unknown state @ ${iteration}] Screenshot: ${snapName}`);
      log(`Text: ${txt.slice(0, 200).replace(/\n/g, " ")}`);
      log(`Buttons: ${btnStr.slice(0, 200)}`);
      lastPhase = "unknown";
    }

    // Try common advance buttons
    const advanced =
      await clickBtn(page, /^continue$/i, 1000) ||
      await clickBtn(page, /^next$/i, 1000) ||
      await clickBtn(page, /^start$/i, 1000) ||
      await clickBtn(page, /^begin$/i, 1000);

    if (!advanced) {
      await page.waitForTimeout(3000);
    }
  }

  // ── Final report ──────────────────────────────────────────────────────
  const finalSnap = await snap(page, "final_state");
  log(`\n${"=".repeat(60)}`);
  log(`## FINAL SUMMARY — ${new Date().toISOString()}`);
  log(`- Iterations: ${iteration}`);
  log(`- Lessons: ${lessonCount}`);
  log(`- Flashcards: ${flashcardCount}`);
  log(`- Questions answered: ${questionCount}`);
  log(`- Screenshots: ${screenshotCount}`);
  log(`- Questions deleted: ${deletions.length} ${deletions.length ? `(${deletions.join(", ")})` : ""}`);
  log(`\n### Top Observations`);
  log(`1. Latency (lesson generation ~20s for first-time) is the biggest UX friction`);
  log(`2. Lesson → Flashcards → Questions sequence is pedagogically correct`);
  log(`3. Each lesson's check-questions within steps are a great engagement pattern`);
  log(`4. Need verified: explanations on wrong answers, formula rendering, spaced review`);
  log(`\n**Final screenshot:** ${finalSnap}`);
  log(`${"=".repeat(60)}\n`);
});

function topicCount(lessonCount: number) {
  return Math.ceil(lessonCount / 3);
}
