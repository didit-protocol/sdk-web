import { defineConfig } from "@playwright/test";

const proofTitle = /visual proof/;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173"
  },
  webServer: {
    command: "node e2e/server.mjs",
    url: "http://127.0.0.1:4173/e2e/fixtures/host.html",
    reuseExistingServer: false
  },
  projects: [
    { name: "chromium", grepInvert: proofTitle, use: { browserName: "chromium" } },
    { name: "firefox", grepInvert: proofTitle, use: { browserName: "firefox" } },
    { name: "webkit", grepInvert: proofTitle, use: { browserName: "webkit" } },
    { name: "chrome-visual", grep: proofTitle, use: { browserName: "chromium", channel: "chrome" } }
  ]
});
