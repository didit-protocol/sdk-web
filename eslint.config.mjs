import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**"] },
  {
    files: ["packages/auth-react/src/**/*.{ts,tsx}", "packages/auth-nextjs/src/**/*.{ts,tsx}", "examples/nextjs/**/*.{ts,tsx}", "examples/react/**/*.{ts,tsx}", "examples/shared/**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: "latest", sourceType: "module" } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-debugger": "error", "no-var": "error", "prefer-const": "error", "no-void": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
