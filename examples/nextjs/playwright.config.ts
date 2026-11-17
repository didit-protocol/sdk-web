import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}
  },
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: true
  }
});
