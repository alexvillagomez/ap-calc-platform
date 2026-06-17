import { test, expect, type Page } from "@playwright/test";

/**
 * Login/Sign-up page + "stay logged in on the same browser" persistence.
 *
 * Proves:
 *  1. A gated page (/math, wrapped in LoginGate) shows the auth form when no session.
 *  2. There is an explicit Log in / Sign up toggle (default = Log in; no username field).
 *  3. Sign up creates the account and reveals the page.
 *  4. Logging in with email + password (no username) works for an existing account.
 *  5. Signing up with an already-registered email is guided to Log in (the exact bug
 *     reported: "says email already exists rather than logging me in").
 *  6. The session is a PERSISTENT httpOnly `lodera_uid` cookie (≈1yr), survives
 *     reload, and a brand-new context restored from storage state (same browser later).
 *  7. /login redirects away when already authenticated; logout brings the gate back.
 *
 * Run: E2E_BASE_URL=http://localhost:3002 npx playwright test auth-persistence
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3002";
const submit = (page: Page) => page.locator('button[type="submit"]');
const toSignup = (page: Page) => page.getByRole("button", { name: "Sign up" }).first();

function freshCreds() {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  return { email: `pw_persist_${stamp}@example.com`, username: `pw_${stamp}`, password: "testpass123" };
}

async function signUp(page: Page, creds: { email: string; username: string; password: string }) {
  await toSignup(page).click();
  await expect(page.locator("#lg-username")).toBeVisible();
  await page.fill("#lg-email", creds.email);
  await page.fill("#lg-username", creds.username);
  await page.fill("#lg-password", creds.password);
  await submit(page).click(); // "Create account"
}

const loggedIn = (page: Page) =>
  expect(page.getByRole("heading", { name: "Choose a course" })).toBeVisible({ timeout: 15000 });

test.describe("Login + same-browser persistence", () => {
  test("sign up, then persist across reload and a new browser context", async ({ page, context }) => {
    const creds = freshCreds();

    // 1 & 2. Gated page shows the auth form; default Log in mode hides the username field.
    await page.goto(`${BASE}/math`);
    await expect(page.locator("#lg-email")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#lg-username")).toHaveCount(0);
    await expect(toSignup(page)).toBeVisible();

    // 3. Sign up → page content appears.
    await signUp(page, creds);
    await loggedIn(page);

    // 6a. Persistent, httpOnly cookie (not a session cookie).
    const uid = (await context.cookies()).find((c) => c.name === "lodera_uid");
    expect(uid, "lodera_uid cookie should be set").toBeTruthy();
    expect(uid!.httpOnly).toBe(true);
    const daysOut = (uid!.expires - Date.now() / 1000) / 86400;
    expect(daysOut, `cookie should outlive the browser session (got ${daysOut.toFixed(0)} days)`).toBeGreaterThan(300);

    // 6b. Reload → still logged in.
    await page.reload();
    await loggedIn(page);

    // 7a. /login redirects away when already authenticated.
    await page.goto(`${BASE}/login`);
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 15000 });

    // 6c. "Same browser, came back later": new context from saved storage state stays logged in.
    const restored = await context.browser()!.newContext({ storageState: await context.storageState(), baseURL: BASE });
    try {
      const p2 = await restored.newPage();
      await p2.goto(`${BASE}/math`);
      await expect(p2.getByRole("heading", { name: "Choose a course" })).toBeVisible({ timeout: 15000 });
    } finally {
      await restored.close();
    }
  });

  test("existing account: log in with email + password (no username)", async ({ page }) => {
    const creds = freshCreds();
    await page.goto(`${BASE}/math`);
    await signUp(page, creds);
    await loggedIn(page);

    // Log out, then LOG IN (default mode) with only email + password.
    expect((await page.request.post(`${BASE}/api/auth/logout`)).ok()).toBeTruthy();
    await page.goto(`${BASE}/math`);
    await expect(page.locator("#lg-email")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#lg-username")).toHaveCount(0); // no username needed to log in
    await page.fill("#lg-email", creds.email);
    await page.fill("#lg-password", creds.password);
    await submit(page).click(); // "Log in"
    await loggedIn(page);
  });

  test("signing up with an existing email guides to Log in (the reported bug)", async ({ page }) => {
    const creds = freshCreds();
    await page.goto(`${BASE}/math`);
    await signUp(page, creds);
    await loggedIn(page);
    expect((await page.request.post(`${BASE}/api/auth/logout`)).ok()).toBeTruthy();

    // Try to SIGN UP again with the same email → conflict message + auto-switch to Log in.
    await page.goto(`${BASE}/math`);
    await signUp(page, creds);
    await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#lg-username")).toHaveCount(0); // switched to Log in mode
    // Completing the login from here works.
    await page.fill("#lg-email", creds.email);
    await page.fill("#lg-password", creds.password);
    await submit(page).click();
    await loggedIn(page);
  });

  test("logout clears the session so the gate returns", async ({ page }) => {
    const creds = freshCreds();
    await page.goto(`${BASE}/math`);
    await signUp(page, creds);
    await loggedIn(page);

    expect((await page.request.post(`${BASE}/api/auth/logout`)).ok()).toBeTruthy();
    await page.reload();
    await expect(page.locator("#lg-email")).toBeVisible({ timeout: 15000 });
  });
});
