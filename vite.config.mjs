import { defineConfig, configDefaults } from "vitest/config";

// Классический JSX (React.createElement) делает встроенный esbuild — плагин React не нужен.
// Статика без обработки (faq.html, logo.png, badges/) лежит в public/ и копируется в dist/ как есть.
export default defineConfig({
  // Тесты из worktree соседних веток (.claude/worktrees) — не наши: прогон вчетверо дольше и таймауты
  test: { exclude: [...configDefaults.exclude, ".claude/**"] }
});
