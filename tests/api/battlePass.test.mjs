// Боевой пропуск через API: задания при добавлении оценок, награды, админка сезона.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, createTestApp, clientFor, newUid, unlock } from "./helpers.mjs";

let env, app;
beforeAll(async () => {
  env = await createTestDb();
  app = await createTestApp(env.db);
});
afterAll(() => env.close());

const D = "2026-10-17";
const add = (call, subject, grade, date = D) => call("POST", "/api/grades", { date, subject, grade });

// Пользователь с открытой админкой
async function adminUser() {
  const call = clientFor(app, newUid());
  const admin = await unlock(call);
  const as = (method, path, body) => call(method, path, body, { admin });
  return { call, as };
}

describe("задания", () => {
  it("streak_fives засчитывается при третьей пятёрке подряд и даёт XP один раз", async () => {
    const { call, as } = await adminUser();
    const task = await as("POST", "/api/admin/tasks", { name: "3 пятёрки", xp: 150, type: "streak_fives", target: 3 });
    expect(task.status).toBe(200);
    await add(call, "А", 5);
    expect((await add(call, "Б", 5)).body.completedTasks).toEqual([]);
    const third = await add(call, "В", 5);
    expect(third.body.completedTasks).toEqual([task.body.id]);
    expect(third.body.state.battlePass).toMatchObject({ xp: 150, level: 0, completedTasks: [task.body.id] });
    expect((await add(call, "Г", 5)).body.state.battlePass.xp).toBe(150);
  });

  it("два задания за раз: XP складывается, уровень растёт, levelUp в ответе", async () => {
    const { call, as } = await adminUser();
    await as("POST", "/api/admin/tasks", { name: "Пятёрка", xp: 120, type: "streak_fives", target: 1 });
    await as("POST", "/api/admin/tasks", { name: "Средний 4.5", xp: 100, type: "average_score", target: 4.5 });
    const res = await add(call, "А", 5);
    expect(res.body.completedTasks).toHaveLength(2);
    expect(res.body.levelUp).toBe(true);
    expect(res.body.state.battlePass).toMatchObject({ xp: 220, level: 1 });
  });

  it("total_grades_week считает оценки за последние 7 дней", async () => {
    const { call, as } = await adminUser();
    await as("POST", "/api/admin/tasks", { name: "2 за неделю", xp: 50, type: "total_grades_week", target: 2 });
    await add(call, "А", 4, "2026-10-01"); // давно — не считается
    expect((await add(call, "А", 4, "2026-10-16")).body.completedTasks).toEqual([]);
    expect((await add(call, "А", 4)).body.completedTasks).toHaveLength(1);
  });

  it("удаление задания не отнимает полученный XP", async () => {
    const { call, as } = await adminUser();
    const task = await as("POST", "/api/admin/tasks", { name: "Пятёрка", xp: 100, type: "streak_fives", target: 1 });
    await add(call, "А", 5);
    const res = await as("DELETE", `/api/admin/tasks/${task.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.state.battlePass).toMatchObject({ xp: 100, tasks: [] });
  });

  it("некорректное задание — 400", async () => {
    const { as } = await adminUser();
    expect((await as("POST", "/api/admin/tasks", { name: "x", xp: 10, type: "unknown" })).status).toBe(400);
    expect((await as("POST", "/api/admin/tasks", { name: "", xp: 10, type: "streak_fives" })).status).toBe(400);
    expect((await as("POST", "/api/admin/tasks", { name: "x", xp: 0, type: "streak_fives" })).status).toBe(400);
  });
});

describe("награды", () => {
  // Пользователь на уровне 1 (xpPerLevel 200, одно задание на 200 XP)
  async function levelOne() {
    const u = await adminUser();
    await u.as("POST", "/api/admin/tasks", { name: "Пятёрка", xp: 200, type: "streak_fives", target: 1 });
    await add(u.call, "А", 5);
    return u;
  }

  it("денежная награда зачисляется записью «🏆 Награда BP» один раз", async () => {
    const { call, as } = await levelOne();
    const reward = await as("POST", "/api/admin/rewards", { level: 1, text: "Бонус 500 ₽", type: "money", amount: 500 });
    const res = await call("POST", `/api/bp/rewards/${reward.body.id}/claim`);
    expect(res.status).toBe(200);
    expect(res.body.state.balance).toBe(750);
    expect(res.body.state.history[0]).toMatchObject({ kind: "bp_reward", subject: "🏆 Награда BP (Ур.1)", reward: 500, bonus: "Бонус 500 ₽" });
    expect(res.body.state.battlePass.claimedRewards).toEqual([reward.body.id]);
    expect((await call("POST", `/api/bp/rewards/${reward.body.id}/claim`)).status).toBe(409);
    expect((await call("GET", "/api/state")).body.balance).toBe(750);
  });

  it("параллельный двойной claim зачисляет один раз", async () => {
    const { call, as } = await levelOne();
    const reward = await as("POST", "/api/admin/rewards", { level: 1, text: "500", type: "money", amount: 500 });
    const results = await Promise.all([1, 2].map(() => call("POST", `/api/bp/rewards/${reward.body.id}/claim`)));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await call("GET", "/api/state")).body.balance).toBe(750);
  });

  it("награда выше уровня — 409", async () => {
    const { call, as } = await levelOne();
    const reward = await as("POST", "/api/admin/rewards", { level: 2, text: "Позже", type: "other" });
    expect((await call("POST", `/api/bp/rewards/${reward.body.id}/claim`)).status).toBe(409);
  });

  it("бейдж активируется и остаётся после удаления награды", async () => {
    const { call, as } = await levelOne();
    const reward = await as("POST", "/api/admin/rewards", { level: 1, text: "Отличник", type: "badge", badgeNumber: 3 });
    expect((await call("POST", `/api/bp/rewards/${reward.body.id}/claim`)).body.state.battlePass.badges).toEqual([3]);
    const res = await as("DELETE", `/api/admin/rewards/${reward.body.id}`);
    expect(res.body.state.battlePass).toMatchObject({ badges: [3], rewards: [] });
  });

  it("чужую награду получить нельзя — 404", async () => {
    const { as } = await levelOne();
    const reward = await as("POST", "/api/admin/rewards", { level: 0, text: "x", type: "money", amount: 100 });
    const other = clientFor(app, newUid());
    expect((await other("POST", `/api/bp/rewards/${reward.body.id}/claim`)).status).toBe(404);
    expect((await other("GET", "/api/state")).body.balance).toBe(0);
  });
});

describe("сезон", () => {
  it("настройки сезона меняют расчёт уровня", async () => {
    const { call, as } = await adminUser();
    await as("POST", "/api/admin/tasks", { name: "Пятёрка", xp: 100, type: "streak_fives", target: 1 });
    await add(call, "А", 5);
    const res = await as("PUT", "/api/admin/season", { season: 2, seasonName: "Зима", maxLevel: 5, xpPerLevel: 50 });
    expect(res.status).toBe(200);
    expect(res.body.state.battlePass).toMatchObject({ season: 2, seasonName: "Зима", maxLevel: 5, xpPerLevel: 50, xp: 100, level: 2 });
  });

  it("сброс убирает задания, награды и прогресс, но не деньги", async () => {
    const { call, as } = await adminUser();
    await as("POST", "/api/admin/tasks", { name: "Пятёрка", xp: 200, type: "streak_fives", target: 1 });
    const reward = await as("POST", "/api/admin/rewards", { level: 1, text: "500", type: "money", amount: 500 });
    await add(call, "А", 5);
    await call("POST", `/api/bp/rewards/${reward.body.id}/claim`);
    const res = await as("POST", "/api/admin/season/reset");
    expect(res.body.state.battlePass).toMatchObject({ xp: 0, level: 0, tasks: [], rewards: [], completedTasks: [], claimedRewards: [], badges: [] });
    expect(res.body.state.balance).toBe(750);
  });

  it("запуск сезона «Пробуждение Силы знаний»: следующий номер, задания и награды пресета, прогресс с нуля", async () => {
    const { call, as } = await adminUser();
    await as("POST", "/api/admin/tasks", { name: "Пятёрка", xp: 250, type: "streak_fives", target: 1 });
    const badge = await as("POST", "/api/admin/rewards", { level: 1, text: "Бейдж", type: "badge", badgeNumber: 2 });
    await add(call, "А", 5);
    await call("POST", `/api/bp/rewards/${badge.body.id}/claim`);

    const res = await as("POST", "/api/admin/season/launch");
    expect(res.status).toBe(200);
    const bp = res.body.state.battlePass;
    expect(bp).toMatchObject({
      season: 2, seasonName: "Пробуждение Силы знаний", maxLevel: 10, xpPerLevel: 200,
      xp: 0, level: 0, completedTasks: [], claimedRewards: [], badges: []
    });
    expect(bp.tasks).toHaveLength(11);
    expect(bp.rewards).toHaveLength(11);
    expect(bp.tasks[0]).toMatchObject({ name: "Первый выстрел: 2 пятёрки подряд", type: "streak_fives", target: 2, xp: 100 });
    expect(bp.rewards.find(r => r.text === "💰 500 ₽")).toMatchObject({ level: 1, type: "money", amount: 500 });
    expect(bp.rewards.find(r => r.text === "Бейдж «Дарт Вейдер»")).toMatchObject({ level: 10, type: "badge", badgeNumber: 5 });
    // Деньги и история не трогаются
    expect(res.body.state.balance).toBe(250);
    expect(res.body.state.history).toHaveLength(1);
  });

  it("задания нового сезона засчитываются, второй запуск — 409", async () => {
    const { call, as } = await adminUser();
    // Цели по среднему считаются от истории. При пустой истории это 5.0 — их закрыла бы первая же пятёрка
    // (так и в Firestore-версии); с четвёркой в истории двух пятёрок для них мало
    await add(call, "А", 4, "2026-10-01");
    await as("POST", "/api/admin/season/launch");
    await add(call, "А", 5);
    const res = await add(call, "Б", 5); // «2 пятёрки подряд»
    expect(res.body.completedTasks).toHaveLength(1);
    expect(res.body.state.battlePass.xp).toBe(100);
    const again = await as("POST", "/api/admin/season/launch");
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/уже запущен/);
  });

  it("без PIN запуск сезона недоступен", async () => {
    const call = clientFor(app, newUid());
    expect((await call("POST", "/api/admin/season/launch")).status).toBe(403);
  });
});
