/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  setupFiles: ["<rootDir>/jest.setup.cjs"],
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }]
  },
  moduleNameMapper: {
    "^react-dom/server$": "<rootDir>/../../node_modules/react-dom/server.node.js",
    "^(\\.{1,2}/.*)\\.js$": "$1"
  }
};
