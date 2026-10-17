// Перенос Firestore → Neon: разбор бэкапа, сверка, запись и проверка через API на PGlite.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb, createTestApp, clientFor } from "../api/helpers.mjs";
import { planUser, planDump, applyUser, ruDateToISO, CORRECTION_SUBJECT } from "../../server/migration/firestore.mjs";

const NOW = new Date("2026-10-17T12:00:00Z");
const plan = (data, opts) => planUser({ id: "u", data }, { now: NOW, ...opts });

// Документ users/{uid} в том виде, как его писал src/App.jsx: история новыми сверху
function fullUser() {
  return {
    balance: 800,
    history: [
      { date: "16.10.2026", subject: "💸 Вывод средств", grade: "—", reward: -300, bonus: "Частичный вывод" },
      { id: "1760600000002", date: "16.10.2026", subject: "Математика", grade: 5, reward: 250, bonus: "" },
      { id: "1760600000001", date: "16.10.2026", subject: "Русский", grade: "4", reward: 100, bonus: "" },
      { id: "1760500000000", date: "15.10.2026", subject: "🏆 Награда BP (Ур.1)", grade: "—", reward: 500, bonus: "Деньги" },
      { id: "1760400000000", date: "5.10.2026", subject: "Физика", grade: 5, reward: 250, bonus: "" }
    ],
    battlePass: {
      season: 2, seasonName: "Зима", maxLevel: 10, xpPerLevel: 200, xp: 350, level: 1,
      tasks: [
        { id: 11, name: "3 пятёрки", xp: 150, type: "streak_fives", target: 3 },
        { id: 12, name: "Средний 4.5", xp: 200, type: "average_score", target: 4.5 }
      ],
      rewards: [
        { id: 21, level: 1, text: "Деньги", type: "money", amount: 500 },
        { id: 22, level: 1, text: "Бейдж", type: "badge", badgeNumber: 2 },
        { id: 23, level: 5, text: "Кино", type: "other" }
      ],
      completedTasks: [11, 12],
      claimedRewards: [21, 22],
      badges: [2]
    }
  };
}

describe("разбор документа", () => {
  it("даты ДД.ММ.ГГГГ и Д.М.ГГГГ → ISO; несуществующие и другие форматы — null", () => {
    expect(ruDateToISO("05.09.2025")).toBe("2025-09-05");
    expect(ruDateToISO("5.9.2025")).toBe("2025-09-05");
    expect(ruDateToISO("31.02.2025")).toBeNull();
    expect(ruDateToISO("2025-09-05")).toBeNull();
    expect(ruDateToISO(undefined)).toBeNull();
  });

  it("полный документ: без ошибок и расхождений, вид записи по префиксу, оценка-строка → число", () => {
    const p = plan(fullUser());
    expect(p.errors).toEqual([]);
    expect(p.mismatches).toEqual({});
    expect(p.blocked).toBe(false);
    expect(p.entries.map(e => e.kind)).toEqual(["cashout", "grade", "grade", "bp_reward", "grade"]);
    expect(p.entries[2]).toMatchObject({ date: "2026-10-16", grade: 4, gradeText: null, reward: 100 });
    expect(p.entries[0]).toMatchObject({ grade: null, gradeText: "—", reward: -300, bonusDesc: "Частичный вывод" });
    expect(p.expected).toMatchObject({ balance: 800, xp: 350, level: 1, badges: [2], completedTasks: 2, claimedRewards: 2 });
  });

  it("записи без id — в начале своего дня, в порядке массива; с id — sortKey = id", () => {
    const p = plan({
      balance: 0,
      history: [
        { date: "16.10.2026", subject: "💸 Вывод средств", reward: -10 },
        { id: "1760600000000", date: "16.10.2026", subject: "А", grade: 5, reward: 30 },
        { date: "16.10.2026", subject: "💸 Вывод средств", reward: -20 },
        { date: "15.10.2026", subject: "💸 Вывод средств", reward: 0 }
      ]
    });
    expect(p.entries.map(e => e.sortKey)).toEqual([2, 1760600000000, 1, 1]);
  });

  it("нечисловая оценка сохраняется текстом, сумма-строка — с предупреждением", () => {
    const p = plan({ balance: 250, history: [{ id: "1", date: "01.10.2026", subject: "А", grade: "н", reward: "250" }] });
    expect(p.entries[0]).toMatchObject({ grade: null, gradeText: "н", reward: 250 });
    expect(p.warnings.join()).toMatch(/сумма-строка/);
    expect(p.blocked).toBe(false);
  });

  it("плохая дата, нецелая сумма, history не массив — ошибки, запись заблокирована", () => {
    const p = plan({
      balance: 0,
      history: [
        { id: "1", date: "2026-10-01", subject: "А", grade: 5, reward: 250 },
        { id: "2", date: "01.10.2026", subject: "Б", grade: 5, reward: 12.5 },
        { id: "3", date: "01.10.2026", subject: "В", grade: 5, reward: "abc" }
      ]
    });
    expect(p.errors).toHaveLength(3);
    expect(p.blocked).toBe(true);
    expect(plan({ balance: 0, history: { 0: {} } }).errors).toContain("history: не массив");
  });

  it("без battlePass — сезон по умолчанию; без balance — 0 с предупреждением", () => {
    const p = plan({ history: [] });
    expect(p.battlePass.season).toMatchObject({ number: 1, maxLevel: 10, xpPerLevel: 200 });
    expect(p.blocked).toBe(false);
    expect(p.warnings.join()).toMatch(/balance/);
  });
});

describe("сверка и корректировки", () => {
  it("баланс не сходится с историей: без --reconcile — блок, с ним — корректирующая запись на разницу", () => {
    const data = { ...fullUser(), balance: 1000 };
    const strict = plan(data);
    expect(strict.mismatches.balance).toEqual({ stored: 1000, computed: 800 });
    expect(strict.blocked).toBe(true);

    const fixed = plan(data, { reconcile: true });
    expect(fixed.blocked).toBe(false);
    const correction = fixed.entries.at(-1);
    expect(correction).toMatchObject({
      date: "2026-10-17", kind: "admin_bonus", subject: CORRECTION_SUBJECT, reward: 200, sortKey: NOW.getTime()
    });
    expect(fixed.expected.balance).toBe(1000);
  });

  it("XP за удалённое задание: расхождение XP, с --reconcile — отметка без задания", () => {
    const data = fullUser();
    data.battlePass.tasks = data.battlePass.tasks.slice(0, 1); // задание 12 (200 XP) удалено
    const strict = plan(data);
    expect(strict.mismatches.xp).toEqual({ stored: 350, computed: 150 });
    expect(strict.blocked).toBe(true);

    const fixed = plan(data, { reconcile: true });
    expect(fixed.battlePass.completions).toContainEqual({ taskRef: null, xp: 200 });
    expect(fixed.expected).toMatchObject({ xp: 350, completedTasks: 1 });
  });

  it("бейдж без отметки о награде: с --reconcile — отметка бейджа без награды", () => {
    const data = fullUser();
    data.battlePass.badges = [2, 4];
    expect(plan(data).mismatches.badges).toEqual({ missing: [4] });
    expect(plan(data, { reconcile: true }).battlePass.claims).toContainEqual({ rewardRef: null, badgeNumber: 4 });
  });

  it("награда получена, но бейджа нет в badges — бейдж не переносится (как видел пользователь)", () => {
    const data = fullUser();
    data.battlePass.badges = [];
    const p = plan(data);
    expect(p.blocked).toBe(false);
    expect(p.expected.badges).toEqual([]);
    expect(p.battlePass.claims.find(c => c.rewardRef === 1).badgeNumber).toBeNull();
  });

  it("бэкап без collections.users — понятная ошибка; другие коллекции — в заметках", () => {
    expect(() => planDump({ collections: {} })).toThrow(/collections\.users/);
    const d = planDump({ collections: { users: [], logs: [] } }, { now: NOW });
    expect(d.notes).toEqual(["коллекция logs не переносится"]);
  });
});

describe("запись в Postgres", () => {
  let env, app;
  beforeAll(async () => {
    env = await createTestDb();
    app = await createTestApp(env.db);
  });
  afterAll(() => env.close());

  const migrate = (uid, data, opts) => applyUser(env.db, planUser({ id: uid, data }, { now: NOW, ...opts }));
  const stateOf = async (uid) => (await clientFor(app, uid)("GET", "/api/state")).body;

  it("API после переноса видит те же баланс, историю в том же порядке и боевой пропуск", async () => {
    await migrate("m-full", fullUser());
    const state = await stateOf("m-full");
    expect(state.balance).toBe(800);
    expect(state.history.map(h => h.subject)).toEqual(["Математика", "Русский", "💸 Вывод средств", "🏆 Награда BP (Ур.1)", "Физика"]);
    expect(state.history[1]).toMatchObject({ date: "16.10.2026", grade: 4, reward: 100 });
    expect(state.battlePass).toMatchObject({
      season: 2, seasonName: "Зима", xp: 350, level: 1, badges: [2]
    });
    expect(state.battlePass.tasks.map(x => x.name)).toEqual(["3 пятёрки", "Средний 4.5"]);
    expect(state.battlePass.completedTasks).toHaveLength(2);
    expect(state.battlePass.claimedRewards).toHaveLength(2);
  });

  it("полученную в Firestore награду нельзя получить второй раз", async () => {
    const state = await stateOf("m-full");
    const money = state.battlePass.rewards.find(r => r.text === "Деньги");
    const res = await clientFor(app, "m-full")("POST", `/api/bp/rewards/${money.id}/claim`);
    expect(res.status).toBe(409);
  });

  it("повторный запуск даёт то же состояние и заменяет данные, созданные через API", async () => {
    await migrate("m-again", fullUser());
    const call = clientFor(app, "m-again");
    await call("POST", "/api/cashout", { amount: 100 });
    await migrate("m-again", fullUser());
    const state = await stateOf("m-again");
    expect(state.balance).toBe(800);
    expect(state.history).toHaveLength(5);
    expect(state.battlePass.xp).toBe(350);
  });

  it("корректировки --reconcile дают сохранённые в Firestore баланс, XP и бейджи", async () => {
    const data = { ...fullUser(), balance: 1000 };
    data.battlePass.tasks = data.battlePass.tasks.slice(0, 1);
    data.battlePass.badges = [2, 4];
    await migrate("m-fix", data, { reconcile: true });
    const state = await stateOf("m-fix");
    expect(state.balance).toBe(1000);
    expect(state.history[0]).toMatchObject({ subject: CORRECTION_SUBJECT, kind: "admin_bonus", reward: 200 });
    expect(state.battlePass).toMatchObject({ xp: 350, level: 1, badges: [2, 4] });
  });

  it("заблокированный план не пишется", async () => {
    await expect(migrate("m-blocked", { ...fullUser(), balance: 1 })).rejects.toThrow(/заблокирован/);
  });

  it("если состояние после записи не совпало с ожидаемым — откат, старые данные на месте", async () => {
    await migrate("m-rollback", fullUser());
    const p = planUser({ id: "m-rollback", data: { balance: 0, history: [] } }, { now: NOW });
    p.expected.balance = 42; // имитация ошибки переноса
    await expect(applyUser(env.db, p)).rejects.toThrow(/откат/);
    expect((await stateOf("m-rollback")).balance).toBe(800);
  });
});

describe("скрипт db:import-firestore", () => {
  const script = fileURLToPath(new URL("../../scripts/import-firestore.mjs", import.meta.url));
  const run = promisify(execFile);
  const dumpFile = (users) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "import-firestore-")), "dump.json");
    fs.writeFileSync(file, JSON.stringify({ collections: { users } }));
    return file;
  };
  const exec = (args, env = {}) =>
    run(process.execPath, [script, ...args], { env: { ...process.env, DATABASE_URL: "", ...env } })
      .then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

  it("без --apply только сверяет: отчёт и код 0", async () => {
    const res = await exec([dumpFile([{ id: "a", data: fullUser() }])]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/✅ a/);
    expect(res.stdout).toMatch(/Сверка без записи/);
  });

  it("расхождение без --reconcile — код 1 и подсказка", async () => {
    const res = await exec([dumpFile([{ id: "a", data: { ...fullUser(), balance: 1 } }]), "--apply"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/--reconcile/);
    expect(res.stderr).toMatch(/Ничего не записано/);
  });

  it("--apply без DATABASE_URL — код 2, неверный вызов — код 2", async () => {
    expect((await exec([dumpFile([{ id: "a", data: fullUser() }]), "--apply"])).code).toBe(2);
    expect((await exec(["--apply"])).code).toBe(2);
    expect((await exec(["x.json", "--force"])).code).toBe(2);
  });
});
