import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  { ignores: ["node_modules/**", "backups/**", "secrets/**", ".claude/worktrees/**"] },
  { ignores: ["dist/**"] },
  js.configs.recommended,
  {
    // Фронтенд собирает Vite; React — из npm, firebase и db — глобалы compat-скриптов из CDN
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, firebase: "readonly", db: "readonly" }
    },
    plugins: { react },
    rules: {
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      // Легаси-код: неиспользуемое — предупреждение, чистится вместе с переездом (этап 5)
      "no-unused-vars": "warn"
    }
  },
  {
    // Тесты экранов (jsdom): JSX, браузер и Node
    files: ["tests/**/*.jsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: { react },
    rules: { "react/jsx-uses-vars": "error", "react/jsx-uses-react": "error" }
  },
  {
    files: ["env.js"],
    languageOptions: { sourceType: "script", globals: globals.browser }
  },
  {
    files: ["api/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module", globals: globals.node }
  }
];
