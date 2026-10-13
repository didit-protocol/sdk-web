/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "jsdom",
  // The page the fixtures were recorded for: its address is the registered redirect.
  testEnvironmentOptions: { url: "http://localhost:4174/e2e/fixtures/app.html" },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // The tests run against the signals source, not a stale build.
    "^@didit-protocol/signals$": "<rootDir>/../signals/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true, diagnostics: false
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
