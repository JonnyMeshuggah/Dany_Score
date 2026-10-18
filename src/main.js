// Точка входа. Источник данных выбирает DATA_BACKEND из /api/env (docs/MIGRATION_PLAN.md, этапы 5–6):
//   "api" — приложение на API и Neon (src/app/), без него — прежнее приложение на Firestore (src/App.jsx).
// Переключение и откат — переменной окружения в Vercel, без изменения кода.
function whenEnvReady(cb) {
  if (window.env) cb(window.env);
  else setTimeout(() => whenEnvReady(cb), 100);
}

whenEnvReady(env => {
  if (env.DATA_BACKEND === "api") import("./app/main.jsx").then(m => m.mount(env));
  else import("./App.jsx"); // запускается сам при импорте
});
