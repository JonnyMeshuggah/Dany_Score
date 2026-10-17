import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  { ignores: ["node_modules/**", "backups/**", "secrets/**", ".claude/worktrees/**"] },
  js.configs.recommended,
  {
    // Браузерный JSX без сборки: транспилирует babel-standalone, глобалы приходят из CDN
    files: ["app.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, React: "readonly", ReactDOM: "readonly", firebase: "readonly", db: "readonly" }
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
