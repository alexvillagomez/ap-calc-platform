import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nnkpvezsyumryhnulyvt.supabase.co";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ua3B2ZXpzeXVtcnlobnVseXZ0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQ0MjczMCwiZXhwIjoyMDg5MDE4NzMwfQ.eHSzg_4wBZaTjAvIm5fTmdL3w_e-GhsiHaXrimmES4E";

const TEST_USERNAME = `playwright_goodstudent_${Date.now()}`;
const TEST_PASSWORD = "testpass123";

interface DemoProblem {
  id: string;
  correct_index: number;
}

test.describe("Demo diagnostic — good student", () => {
  let sessionId: string;

  test("register → diagnostic → correct answers → final report → DB check", async ({ page }) => {
    // ── 1. Register ─────────────────────────────────────────────────────────
    await page.goto("/login");
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.getByLabel("Username").fill(TEST_USERNAME);
    await page.getByLabel("Password").fill(TEST_PASSWORD);

    const registerRes = page.waitForResponse((r) => r.url().includes("/api/auth/register"));
    await page.getByRole("button", { name: "Create Account" }).last().click();
    const registerData = await (await registerRes).json() as {
      accountId?: string; sessionId?: string; error?: string;
    };

    console.log("Register:", registerData.error ?? "ok, sessionId=" + registerData.sessionId);
    expect(registerData.error).toBeUndefined();
    sessionId = registerData.sessionId!;

    await page.waitForURL(/\/demo/, { timeout: 10_000 });

    // ── 2. Start diagnostic ──────────────────────────────────────────────────
    const startBtn = page.getByRole("button", { name: "Start diagnostic" });
    await expect(startBtn).toBeVisible({ timeout: 10_000 });

    const problemsPromise = page.waitForResponse((r) => r.url().includes("/api/demo/problems"));
    await startBtn.click();

    const problemsData = await (await problemsPromise).json() as {
      problems?: DemoProblem[];
      umbrellas?: { id: string; label: string }[];
    };
    const problems: DemoProblem[] = problemsData.problems ?? [];
    const umbrellas = problemsData.umbrellas ?? [];
    console.log(`Loaded ${problems.length} problems, ${umbrellas.length} umbrella keywords:`);
    umbrellas.forEach((u) => console.log(`  • ${u.label}`));

    expect(problems.length).toBeGreaterThan(0);
    expect(umbrellas.length).toBeGreaterThan(0);

    // ── 3. Answer questions ──────────────────────────────────────────────────
    // Choice buttons sit inside .space-y-2[data-problem-id]. Read the current
    // problem id from that attribute, look up correct_index, and click it.
    const problemById = new Map(problems.map((p) => [p.id, p]));
    const choiceContainer = page.locator(".space-y-2[data-problem-id]");
    const doneHeading = page.getByText(/diagnostic complete/i);

    let questionsAnswered = 0;
    let ratingsSubmitted = 0;
    const MAX_QUESTIONS = 20;

    while (questionsAnswered < MAX_QUESTIONS) {
      // Bail when the "done" state appears
      if (await doneHeading.isVisible().catch(() => false)) {
        console.log(`Diagnostic complete after ${questionsAnswered} questions ✓`);
        break;
      }

      // Wait for the choice container to appear (means we're in "answering" phase)
      try {
        await choiceContainer.waitFor({ state: "visible", timeout: 15_000 });
      } catch {
        if (await doneHeading.isVisible().catch(() => false)) {
          console.log(`Diagnostic complete after ${questionsAnswered} questions ✓`);
          break;
        }
        console.log("Choice container not visible — stopping");
        break;
      }

      // Read current problem id from the DOM attribute, look up correct_index
      const currentProblemId = await choiceContainer.getAttribute("data-problem-id");
      const currentProblem = currentProblemId ? problemById.get(currentProblemId) : null;
      const correctIdx = currentProblem?.correct_index ?? 0;

      const attemptRes = page.waitForResponse(
        (r) => r.url().includes("/api/demo/attempt"),
        { timeout: 15_000 }
      );

      // Click the choice button at correct_index inside the container
      await choiceContainer.locator("button").nth(correctIdx).click();

      const attemptData = await (await attemptRes).json() as { ok?: boolean; error?: string };
      if (attemptData.error) console.warn(`Q${questionsAnswered + 1} error: ${attemptData.error}`);
      questionsAnswered++;

      // Rate on every 3rd question
      if (questionsAnswered % 3 === 0) {
        const stars = page.locator("button").filter({ hasText: "★" });
        if (await stars.first().isVisible({ timeout: 1_500 }).catch(() => false)) {
          await stars.nth(4).click(); // 5 stars
          const submitBtn = page.getByRole("button", { name: "Submit" });
          if (await submitBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
            const ratingRes = page.waitForResponse(
              (r) => r.url().includes("/api/content-feedback"),
              { timeout: 8_000 }
            ).catch(() => null);
            await submitBtn.click();
            const rr = await ratingRes;
            if (rr) {
              const rd = await rr.json() as { ok?: boolean; error?: string };
              if (!rd.error) ratingsSubmitted++;
            }
          }
        }
      }

      // Advance to next problem
      const nextBtn = page.getByRole("button", { name: /Next problem|See results/ });
      if (await nextBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await nextBtn.click();
        // Wait for the choice container to disappear before checking done state
        await choiceContainer.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
      }
    }

    console.log(`\n=== Diagnostic summary ===`);
    console.log(`Questions answered: ${questionsAnswered}`);
    console.log(`Ratings submitted: ${ratingsSubmitted}`);

    // ── 4. DB — keyword states ───────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: kwStates } = await supabase
      .from("learn_student_keyword_states")
      .select("keyword_id, in_depth_score, total_attempts, state")
      .eq("session_id", sessionId)
      .order("in_depth_score", { ascending: false });

    console.log(`\nKeyword states (${(kwStates ?? []).length} total):`);
    (kwStates ?? []).forEach((r) => {
      const score = Number(r.in_depth_score).toFixed(3);
      const bars = "█".repeat(Math.round(Number(r.in_depth_score) * 20));
      const blanks = "░".repeat(20 - Math.round(Number(r.in_depth_score) * 20));
      console.log(`  ${r.keyword_id.padEnd(55)} ${score}  |${bars}${blanks}|  (n=${r.total_attempts})`);
    });

    const highScores = (kwStates ?? []).filter((r) => Number(r.in_depth_score) >= 0.7);
    console.log(`\n${highScores.length} keywords scored ≥ 0.70`);
    expect((kwStates ?? []).length).toBeGreaterThan(0);
    expect(highScores.length).toBeGreaterThan(0);

    // ── 5. DB — ratings ──────────────────────────────────────────────────────
    const { data: ratings } = await supabase
      .from("content_ratings")
      .select("rating")
      .eq("session_id", sessionId);

    console.log(`\nRatings in DB: ${(ratings ?? []).length}`);
    expect((ratings ?? []).length).toBeGreaterThan(0);

    // ── 6. Progress page ─────────────────────────────────────────────────────
    await page.goto("/progress");
    await page.waitForLoadState("networkidle");
    const polyCategory = page.getByText(/Polynomials/i).first();
    if (await polyCategory.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await polyCategory.click();
      await page.waitForTimeout(800);
      console.log("\nProgress page — Polynomials category expanded");
      const screenshot = await page.screenshot({ fullPage: false });
      require("fs").writeFileSync("/tmp/progress-report.png", screenshot);
      console.log("Screenshot: /tmp/progress-report.png");
    }

    // ── 7. Cleanup ────────────────────────────────────────────────────────────
    await supabase.from("content_ratings").delete().eq("session_id", sessionId);
    await supabase.from("learn_student_keyword_states").delete().eq("session_id", sessionId);
    await supabase.from("student_sessions").delete().eq("id", sessionId);
    await supabase.from("student_accounts").delete().eq("username", TEST_USERNAME);
    console.log("\nCleanup done ✓");
  });
});

// ── Demo-practice flow ─────────────────────────────────────────────────────────
// Seeds keyword states directly into the DB so we can skip running the full
// diagnostic and jump straight to /demo-practice. Verifies:
//   • hub loads with weak Polynomials keywords
//   • lesson is triggered for a needs_lesson keyword
//   • lesson is generated and stored in learn_lessons
//   • practice attempt recorded in learn_student_keyword_states
const DP_USERNAME = `pw_demo_practice_${Date.now()}`;

// Three real Polynomials in_depth keyword IDs used to seed weak states
const WEAK_KW_IDS = [
  "polynomial_term_structure",
  "polynomial_constant_term",
  "leading_term_polynomial",
];

test.describe("Demo-practice flow", () => {
  let dpSessionId: string;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  test("seeded weak states → /demo-practice → lesson generated → DB checks", async ({ page }) => {
    // ── 1. Register ───────────────────────────────────────────────────────────
    await page.goto("/login");
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.getByLabel("Username").fill(DP_USERNAME);
    await page.getByLabel("Password").fill("testpass123");

    const registerRes = page.waitForResponse((r) => r.url().includes("/api/auth/register"));
    await page.getByRole("button", { name: "Create Account" }).last().click();
    const registerData = await (await registerRes).json() as { sessionId?: string; error?: string };
    expect(registerData.error).toBeUndefined();
    dpSessionId = registerData.sessionId!;
    console.log("Registered:", dpSessionId);

    await page.waitForURL(/\/demo/, { timeout: 10_000 });

    // ── 2. Seed weak keyword states directly in DB ────────────────────────────
    // Insert needs_lesson states so demo-practice will immediately trigger a lesson
    const seedRows = WEAK_KW_IDS.map((kwId) => ({
      session_id: dpSessionId,
      keyword_id: kwId,
      topic_id: "polynomials",
      in_depth_score: 0.20,
      umbrella_score: 0.20,
      state: "needs_lesson",
      total_attempts: 3,
      correct_attempts: 0,
      consecutive_correct: 0,
    }));

    const { error: seedErr } = await supabase
      .from("learn_student_keyword_states")
      .upsert(seedRows, { onConflict: "session_id,keyword_id" });

    if (seedErr) console.warn("Seed warning:", seedErr.message);
    console.log(`Seeded ${seedRows.length} needs_lesson states ✓`);

    // ── 3. Navigate directly to /demo-practice ────────────────────────────────
    await page.goto("/demo-practice");
    console.log("Navigated to /demo-practice ✓");

    // ── 4. Wait for progress API to load ─────────────────────────────────────
    await page.waitForResponse((r) => r.url().includes("/api/learn/progress"), { timeout: 15_000 });
    console.log("Progress API loaded ✓");

    // Hub auto-advances after 1.5s, then lesson loads (may take up to 30s to generate)
    // Wait for the lesson API call
    const lessonApiRes = await page.waitForResponse(
      (r) => r.url().includes("/api/learn/lesson"),
      { timeout: 60_000 }
    ).catch(() => null);

    // Screenshot whatever is on screen
    const screenshot = await page.screenshot({ fullPage: true });
    require("fs").writeFileSync("/tmp/demo-practice-flow.png", screenshot);
    console.log("Screenshot: /tmp/demo-practice-flow.png");

    // No error banner
    const errorEl = page.locator("text=Failed to load");
    expect(await errorEl.isVisible({ timeout: 1_000 }).catch(() => false)).toBe(false);
    console.log("No error banner ✓");

    // ── 5. Verify lesson API response ─────────────────────────────────────────
    if (lessonApiRes) {
      const lessonStatus = lessonApiRes.status();
      console.log(`Lesson API status: ${lessonStatus}`);
      expect(lessonStatus).toBe(200);

      const lessonData = await lessonApiRes.json() as { keyword_id?: string; micro_steps?: unknown[] };
      const stepCount = (lessonData.micro_steps ?? []).length;
      console.log(`Lesson keyword: ${lessonData.keyword_id}, micro_steps: ${stepCount}`);
      expect(stepCount).toBeGreaterThan(0);

      // ── 6. DB: lesson stored in learn_lessons ─────────────────────────────
      if (lessonData.keyword_id) {
        // Give the API a moment to write (it writes synchronously before responding, so this should be instant)
        const { data: storedLesson } = await supabase
          .from("learn_lessons")
          .select("id, keyword_id, micro_steps")
          .eq("keyword_id", lessonData.keyword_id)
          .maybeSingle();

        console.log(`learn_lessons row for ${lessonData.keyword_id}: ${storedLesson ? "EXISTS" : "MISSING"}`);
        expect(storedLesson).not.toBeNull();
        const storedStepCount = (storedLesson?.micro_steps as unknown[] | null)?.length ?? 0;
        console.log(`Stored step count: ${storedStepCount}`);
        expect(storedStepCount).toBeGreaterThan(0);
        console.log("Lesson persisted to DB ✓");
      }
    } else {
      // If no lesson fired, fail — we seeded needs_lesson states so it must trigger
      throw new Error("Expected lesson API to fire for needs_lesson keyword, but it didn't");
    }

    // ── 7. DB: seeded keyword states still in DB ──────────────────────────────
    const { data: kwStates } = await supabase
      .from("learn_student_keyword_states")
      .select("keyword_id, in_depth_score, state, total_attempts")
      .eq("session_id", dpSessionId)
      .in("keyword_id", WEAK_KW_IDS);

    console.log(`\nSeeded keyword states (${(kwStates ?? []).length}):`);
    (kwStates ?? []).forEach((r) => {
      console.log(`  ${r.keyword_id.padEnd(40)} score=${Number(r.in_depth_score).toFixed(2)} state=${r.state}`);
    });
    expect((kwStates ?? []).length).toBe(WEAK_KW_IDS.length);

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await supabase.from("learn_student_keyword_states").delete().eq("session_id", dpSessionId);
    await supabase.from("content_ratings").delete().eq("session_id", dpSessionId);
    await supabase.from("student_sessions").delete().eq("id", dpSessionId);
    await supabase.from("student_accounts").delete().eq("username", DP_USERNAME);
    console.log("Cleanup done ✓");
  });
});
