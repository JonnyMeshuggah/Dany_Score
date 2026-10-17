// Перенос бэкапа Firestore в Neon (docs/MIGRATION_PLAN.md, этап 4). Запускает человек, к ветке Neon:
//   npm run db:import-firestore -- backups/firestore-….json                 — только сверка, без записи
//   npm run db:import-firestore -- <файл> --reconcile                       — сверка с корректировками
//   DATABASE_URL='postgres://…' npm run db:import-firestore -- <файл> --apply [--reconcile]
// Данные каждого пользователя из бэкапа в Neon заменяются целиком — повторный запуск даёт тот же результат.
// Коды выхода: 0 — всё готово или записано, 1 — есть ошибки или расхождения, 2 — неверный вызов.
import fs from "node:fs";
import { planDump, applyUser, formatReport } from "../server/migration/firestore.mjs";

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith("--")));
const files = args.filter(a => !a.startsWith("--"));
const unknown = [...flags].filter(f => !["--apply", "--reconcile"].includes(f));
if (files.length !== 1 || unknown.length) {
  console.error("Использование: npm run db:import-firestore -- <бэкап.json> [--reconcile] [--apply]");
  process.exit(2);
}
const apply = flags.has("--apply");
const reconcile = flags.has("--reconcile");

const plan = planDump(JSON.parse(fs.readFileSync(files[0], "utf8")), { now: new Date(), reconcile });
console.log(formatReport(plan, { reconcile }));

const blocked = plan.users.filter(p => p.blocked);
if (!apply) {
  console.log(blocked.length ? "\nЗапись невозможна, пока есть заблокированные пользователи." : "\nСверка без записи. Для записи добавьте --apply и DATABASE_URL.");
  process.exit(blocked.length ? 1 : 0);
}
if (blocked.length) {
  console.error("\n❌ Ничего не записано: есть заблокированные пользователи.");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("\n❌ Задайте DATABASE_URL (строка подключения к ветке Neon).");
  process.exit(2);
}

// Подключение — только при --apply: сверке база не нужна
const { withNeonDb } = await import("../server/db/client.mjs");
console.log(`\nЗапись в ${new URL(url).host}…`);
try {
  await withNeonDb(url, async db => {
    for (const p of plan.users) {
      const state = await applyUser(db, p);
      console.log(`✅ ${p.uid}: записей ${state.history.length}, баланс ${state.balance}, XP ${state.battlePass.xp}, уровень ${state.battlePass.level}`);
    }
  });
} catch (err) {
  // Пользователи до ошибки уже записаны; повторный запуск после исправления их перезапишет
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
}
console.log("Готово: состояние каждого пользователя сверено с Firestore.");
