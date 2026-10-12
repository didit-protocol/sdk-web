/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "jsdom",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // sdk-web's tests run against the signals source, not a stale build.
    "^@didit-protocol/signals$": "<rootDir>/packages/signals/src/index.ts"
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true
      }
    ]
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "packages/*/src/**/*.ts",
    "!**/*.d.ts",
    "!**/__tests__/**"
  ],
  coverageDirectory: "coverage",
  verbose: true
};
