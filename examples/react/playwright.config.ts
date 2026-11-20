import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3003",
    browserName: "chromium",
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3003",
    reuseExistingServer: true
  }
});
