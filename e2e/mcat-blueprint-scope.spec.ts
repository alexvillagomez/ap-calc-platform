import { test, expect } from "@playwright/test";

/**
 * Blueprint scope regression (end-to-end against the running dev server).
 *
 * Verifies the durable fix in the REAL wired server path — route loads
 * mcat_keywords.concept_blueprint, threads it into the generator, and the
 * served/generated questions for `gibbs_free_energy_sign_and_spontaneity`
 * stay inside the keyword's scope (no ΔH/ΔS/temperature-formula leak). Also
 * checks the lesson generates and stays in scope.
 *
 * The API tests exercise exactly the code changed by the fix (next-question +
 * lesson routes + mcatGenerator blueprint injection) without fragile DOM
 * selectors. A light UI smoke test confirms the practice page renders.
 *
 * Run (dev server must be on :3002):
 *   npx playwright test mcat-blueprint-scope
 */

const CATEGORY_ID = "mcat_biology_bioenergetics_and_metabolism";
const KEYWORD_ID = "gibbs_free_energy_sign_and_spontaneity";
const KEYWORD_LABEL = "Gibbs free energy sign and spontaneity";

// Flags out-of-scope content for the sign keyword. A bare ΔG value in kJ/mol is
// IN scope and must NOT be flagged — only enthalpy/entropy/temperature-formula
// signals (the original drift) are violations.
const OUT_OF_SCOPE_RE =
  /(ΔH|ΔS|TΔS|ΔH\s*[-−]\s*T|enthalp|entrop|J\/\(?mol[·*\s]?K|crossover|at what temperature|temperature at which)/i;

type RegisterResp = { accountId?: string; sessionId?: string };
type Question = {
  id: string;
  stem: string;
  choices: string[];
  explanation: string;
};

async function register(request: import("@playwright/test").APIRequestContext) {
  const username = `pw_scope_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const res = await request.post("/api/auth/register", {
    data: { username, password: "testpass123" },
  });
  expect(res.ok(), `register should succeed (got ${res.status()})`).toBeTruthy();
  const data = (await res.json()) as RegisterResp;
  expect(data.accountId, "register returns accountId").toBeTruthy();
  expect(data.sessionId, "register returns sessionId").toBeTruthy();
  // Bootstrap the student_sessions row (mirrors getOrCreateMcatSession).
  await request.post("/api/session", { data: { sessionId: data.sessionId } });
  return { accountId: data.accountId!, sessionId: data.sessionId! };
}

test.describe("MCAT blueprint scope — Gibbs free energy sign keyword", () => {
  test("served/generated practice questions stay within scope", async ({ request }) => {
    test.setTimeout(240_000); // generation is slow

    const { sessionId } = await register(request);

    const seen: string[] = [];
    const captured: { stem: string; inScope: boolean; match?: string }[] = [];
    const TARGET = 8;

    for (let i = 0; i < TARGET; i++) {
      const res = await request.post("/api/mcat/next-question", {
        data: {
          session_id: sessionId,
          category_id: CATEGORY_ID,
          keyword_id: KEYWORD_ID,
          exclude_ids: seen,
        },
        timeout: 60_000,
      });
      expect(res.ok(), `next-question #${i + 1} should be 200 (got ${res.status()})`).toBeTruthy();
      const body = (await res.json()) as { question?: Question; generated?: boolean };
      const q = body.question;
      expect(q?.id, `next-question #${i + 1} returns a question`).toBeTruthy();
      if (!q) break;
      seen.push(q.id);

      const blob = `${q.stem} ${(q.choices ?? []).join(" ")}`;
      const m = OUT_OF_SCOPE_RE.exec(blob);
      captured.push({ stem: q.stem, inScope: !m, match: m?.[0] });
    }

    // Report every captured question for transparency.
    console.log(`\n[scope-spec] Captured ${captured.length} sign-keyword questions:`);
    for (const c of captured) {
      console.log(`  ${c.inScope ? "✓" : `⚠️ "${c.match}"`} | ${c.stem.slice(0, 90)}`);
    }

    expect(captured.length, "should have collected questions").toBeGreaterThanOrEqual(5);
    const violations = captured.filter((c) => !c.inScope);
    expect(
      violations,
      `out-of-scope questions served:\n${violations.map((v) => `  - "${v.match}" in: ${v.stem}`).join("\n")}`
    ).toHaveLength(0);
  });

  test("lesson generates and stays within scope", async ({ request }) => {
    test.setTimeout(120_000);
    await register(request); // lesson route is GET + keyword-scoped; no session needed, but keep auth parity

    const res = await request.get(`/api/mcat/lesson/${KEYWORD_ID}`, { timeout: 90_000 });
    expect(res.ok(), `lesson should be 200 (got ${res.status()})`).toBeTruthy();
    const body = (await res.json()) as {
      micro_steps?: { explanation_latex: string; example_latex: string; check_question?: { latex_content: string; choices: string[] } }[];
    };
    expect(Array.isArray(body.micro_steps), "lesson has micro_steps").toBeTruthy();
    expect(body.micro_steps!.length, "lesson has >=3 steps").toBeGreaterThanOrEqual(3);

    // Concatenate the full lesson text and assert it teaches the in-scope concept
    // (sign of ΔG) without drifting into the ΔH/ΔS/temperature formula.
    const lessonText = body
      .micro_steps!.map((s) =>
        [s.explanation_latex, s.example_latex, s.check_question?.latex_content, ...(s.check_question?.choices ?? [])].join(" ")
      )
      .join(" ");
    const m = OUT_OF_SCOPE_RE.exec(lessonText);
    expect(m === null, `lesson drifted out of scope: matched "${m?.[0]}"`).toBeTruthy();
    console.log(`[scope-spec] Lesson: ${body.micro_steps!.length} steps, all in scope.`);
  });

  test("practice page renders (UI smoke)", async ({ page, request }) => {
    test.setTimeout(120_000);
    const { accountId, sessionId } = await register(request);
    await page.addInitScript(
      ([acct, sess]) => {
        localStorage.setItem("ap_calc_account_id", acct);
        localStorage.setItem("ap_calc_student_session_id", sess);
        localStorage.setItem("mcat_onboarding_seen", "1");
      },
      [accountId, sessionId]
    );

    const url =
      `/mcat/${CATEGORY_ID}/practice?keyword=${KEYWORD_ID}&label=${encodeURIComponent(KEYWORD_LABEL)}`;
    const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
    expect(resp?.status(), "practice page should not be a 5xx").toBeLessThan(500);
    // It must not be stuck on the login redirect (auth gate satisfied).
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    // Some MCAT chrome should render (difficulty selector or the topic header).
    await expect(
      page.getByText(/Adaptive|Bioenergetics|Gibbs|warm-up|question/i).first()
    ).toBeVisible({ timeout: 60_000 });
    console.log("[scope-spec] Practice page rendered without crash/redirect.");
  });
});
