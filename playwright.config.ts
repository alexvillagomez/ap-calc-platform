import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3002",
    headless: true,
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
});
