import { defineConfig } from "@playwright/test";

const live = /live\.spec\.mjs$/;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  reporter: "list",
  // The recorded API serves one scenario at a time.
  workers: 1,
  webServer: {
    command: "node e2e/server.mjs",
    url: "http://localhost:4174/e2e/fixtures/app.html",
    reuseExistingServer: false
  },
  projects: [
    { name: "chromium", testIgnore: live, use: { browserName: "chromium" } },
    { name: "firefox", testIgnore: live, use: { browserName: "firefox" } },
    { name: "webkit", testIgnore: live, use: { browserName: "webkit" } },
    // Against a running Didit auth service; see e2e/live.spec.mjs.
    { name: "live", testMatch: live, use: { browserName: "chromium" } }
  ]
});
