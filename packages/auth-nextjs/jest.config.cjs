/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }]
  },
  moduleNameMapper: {
    // Test against the auth-react source, so the suite needs no build first.
    "^@didit-protocol/auth-react/provider$": "<rootDir>/../auth-react/src/provider.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1"
  }
};
