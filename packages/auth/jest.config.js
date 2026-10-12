/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "jsdom",
  // The page the fixtures were recorded for: its address is the registered redirect.
  testEnvironmentOptions: { url: "http://localhost:4174/e2e/fixtures/app.html" },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // Until @didit-protocol/signals lands in this workspace, run the fingerprint source it is built from.
    "^@didit-protocol/signals$": "<rootDir>/../../src/fingerprint.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true
      }
    ]
  },
  setupFiles: ["<rootDir>/src/__tests__/helpers/setup.ts"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json", "node"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/__tests__/**"],
  coverageDirectory: "coverage",
  verbose: true
};
