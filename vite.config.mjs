import { defineConfig } from "vite";

// Классический JSX (React.createElement) делает встроенный esbuild — плагин React не нужен.
// Статика без обработки (faq.html, logo.png, badges/) лежит в public/ и копируется в dist/ как есть.
export default defineConfig({});
