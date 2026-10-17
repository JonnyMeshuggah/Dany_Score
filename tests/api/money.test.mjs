// Деньги через API: награды и бонусы по public/faq.html, удаление с пересчётом, вывод, изоляция.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, createTestApp, clientFor, newUid, unlock } from "./helpers.mjs";

let env, app;
beforeAll(async () => {
  env = await createTestDb();
  app = await createTestApp(env.db);
});
afterAll(() => env.close());

const D = "2026-10-17";
const user = () => clientFor(app, newUid());
const add = (call, subject, grade, date = D) => call("POST", "/api/grades", { date, subject, grade });

async function addAll(call, list) {
  const rewards = [];
  for (const [subject, grade, date] of list) {
    const res = await add(call, subject, grade, date);
    expect(res.status).toBe(200);
    rewards.push(res.body.entry.reward);
  }
  return rewards;
}

describe("добавление оценки", () => {
  it("базовые награды: 5 → +250, 4 → +100, 3 → −500, 2 → −2000 (в разные дни)", async () => {
    const call = user();
    const r = await addAll(call, [["А", 5, "2026-10-01"], ["А", 4, "2026-10-02"], ["А", 3, "2026-10-03"], ["А", 2, "2026-10-04"]]);
    expect(r).toEqual([250, 100, -500, -2000]);
    expect((await call("GET", "/api/state")).body.balance).toBe(250 + 100 - 500 - 2000);
  });

  it("бонусы дня и серии — как в доменных правилах", async () => {
    expect(await addAll(user(), [["Алгебра", 5], ["Физика", 5], ["История", 5]])).toEqual([250, 500, 750]);
    expect(await addAll(user(), [["Алгебра", 5], ["Алгебра", 5]])).toEqual([250, 625]);
    expect(await addAll(user(), [["Алгебра", 5], ["Алгебра", 5], ["Алгебра", 5]])).toEqual([250, 625, 875]);
    expect(await addAll(user(), [["Алгебра", 5], ["Алгебра", 4], ["Алгебра", 5]])).toEqual([250, 100, 500]);
  });

  it("ответ содержит запись в формате истории и свежее состояние", async () => {
    const call = user();
    const res = await add(call, "Алгебра", 5);
    expect(res.body.entry).toMatchObject({ kind: "grade", date: "17.10.2026", subject: "Алгебра", grade: 5, reward: 250, bonus: "" });
    expect(res.body.state.balance).toBe(250);
    expect(res.body.state.history).toHaveLength(1);
  });

  it("история — новые даты сверху, внутри дня — последняя добавленная сверху", async () => {
    const call = user();
    await addAll(call, [["А", 4, "2026-10-16"], ["Б", 4], ["В", 4]]);
    const { history } = (await call("GET", "/api/state")).body;
    expect(history.map(e => e.subject)).toEqual(["В", "Б", "А"]);
  });

  const invalid = {
    "оценка 6": { date: D, subject: "А", grade: 6 },
    "оценка строкой": { date: D, subject: "А", grade: "5" },
    "без предмета": { date: D, subject: " ", grade: 5 },
    "дата в формате ДД.ММ.ГГГГ": { date: "17.10.2026", subject: "А", grade: 5 },
    "несуществующая дата": { date: "2026-02-30", subject: "А", grade: 5 }
  };
  for (const [name, body] of Object.entries(invalid)) {
    it(`${name} — 400, ничего не записано`, async () => {
      const call = user();
      expect((await call("POST", "/api/grades", body)).status).toBe(400);
      expect((await call("GET", "/api/state")).body.history).toEqual([]);
    });
  }

  it("параллельные добавления в один день дают те же бонусы, что последовательные", async () => {
    const call = user();
    const results = await Promise.all([add(call, "Алгебра", 5), add(call, "Физика", 5), add(call, "История", 5)]);
    expect(results.every(r => r.status === 200)).toBe(true);
    const { history, balance } = (await call("GET", "/api/state")).body;
    expect(history.map(e => e.reward).sort((a, b) => a - b)).toEqual([250, 500, 750]);
    expect(balance).toBe(1500);
  });
});

describe("удаление записи", () => {
  it("пересчитывает бонусы оставшихся записей того же дня", async () => {
    const call = user();
    await addAll(call, [["Алгебра", 5], ["Алгебра", 5], ["Физика", 5]]); // 250, 625, 750
    const { history } = (await call("GET", "/api/state")).body;
    const first = history[history.length - 1]; // самая ранняя пятёрка дня
    const res = await call("DELETE", `/api/entries/${first.id}`);
    expect(res.status).toBe(200);
    // Осталось: Алгебра 5 (первая за день) → 250, Физика 5 (вторая за день) → 500
    expect(res.body.state.history.map(e => e.reward)).toEqual([500, 250]);
    expect(res.body.state.balance).toBe(750);
  });

  it("другие дни не трогает", async () => {
    const call = user();
    await addAll(call, [["А", 5, "2026-10-16"], ["А", 5, "2026-10-16"], ["Б", 5]]);
    const { history } = (await call("GET", "/api/state")).body;
    await call("DELETE", `/api/entries/${history[0].id}`);
    expect((await call("GET", "/api/state")).body.history.map(e => e.reward)).toEqual([625, 250]);
  });

  it("чужую запись удалить нельзя — 404, и она остаётся у владельца", async () => {
    const owner = user();
    const { entry } = (await add(owner, "А", 5)).body;
    expect((await user()("DELETE", `/api/entries/${entry.id}`)).status).toBe(404);
    expect((await owner("GET", "/api/state")).body.history).toHaveLength(1);
  });

  it("несуществующая — 404, нечисловой id — 400", async () => {
    const call = user();
    expect((await call("DELETE", "/api/entries/999999")).status).toBe(404);
    expect((await call("DELETE", "/api/entries/abc")).status).toBe(400);
  });
});

describe("вывод средств", () => {
  it("уменьшает баланс и пишет запись «💸 Вывод средств» сегодняшним днём", async () => {
    const call = user();
    await add(call, "А", 5);
    const res = await call("POST", "/api/cashout", { amount: 200 });
    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ kind: "cashout", date: "17.10.2026", subject: "💸 Вывод средств", grade: "—", reward: -200, bonus: "Частичный вывод" });
    expect(res.body.state.balance).toBe(50);
  });

  it("больше баланса — 409, баланс не меняется", async () => {
    const call = user();
    await add(call, "А", 5);
    expect((await call("POST", "/api/cashout", { amount: 251 })).status).toBe(409);
    expect((await call("GET", "/api/state")).body.balance).toBe(250);
  });

  it("параллельные выводы не уводят баланс в минус", async () => {
    const call = user();
    await add(call, "А", 5);
    const results = await Promise.all([1, 2, 3].map(() => call("POST", "/api/cashout", { amount: 200 })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409, 409]);
    expect((await call("GET", "/api/state")).body.balance).toBe(50);
  });

  it("ноль, отрицательная и дробная сумма — 400", async () => {
    const call = user();
    for (const amount of [0, -100, 10.5, "abc"]) {
      expect((await call("POST", "/api/cashout", { amount })).status).toBe(400);
    }
  });
});

describe("изоляция пользователей", () => {
  it("пользователь видит только свои записи и свой баланс", async () => {
    const a = user(), b = user();
    await add(a, "А", 5);
    await add(b, "Б", 4);
    expect((await a("GET", "/api/state")).body.history.map(e => e.subject)).toEqual(["А"]);
    expect((await b("GET", "/api/state")).body.balance).toBe(100);
  });

  it("бонусы считаются только по своим записям дня", async () => {
    const a = user(), b = user();
    await add(a, "Алгебра", 5);
    expect((await add(b, "Алгебра", 5)).body.entry.reward).toBe(250);
  });
});

describe("экспорт и импорт CSV", () => {
  it("экспорт — тот же формат, что у кнопки в приложении", async () => {
    const call = user();
    await addAll(call, [["Алгебра", 5], ["Алгебра", 5]]);
    const res = await call("GET", "/api/export.csv");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toMatch(/text\/csv/);
    expect(res.body.split("\n")).toEqual([
      '"Дата","Предмет","Оценка","Бонус","Сумма"',
      '"17.10.2026","Алгебра","5","Бонус 2.5 за 2 подряд по предмету","625"',
      '"17.10.2026","Алгебра","5","","250"'
    ]);
  });

  it("импорт заменяет историю, суммы — как в файле, вид записи — по префиксу", async () => {
    const call = user();
    await add(call, "Старое", 5);
    const admin = await unlock(call);
    const csv = [
      '"Дата","Предмет","Оценка","Бонус","Сумма"',
      '"17.10.2026","💸 Вывод средств","—","Частичный вывод","-100"',
      '"16.10.2026","Алгебра","5","","999"',
      '"16.10.2026","Физика","н","",""',
      '"мусор","x","5","","1"'
    ].join("\n");
    const res = await call("POST", "/api/admin/import", { csv }, { admin });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(3);
    const { history, balance } = res.body.state;
    expect(history.map(e => [e.kind, e.subject, e.grade, e.reward])).toEqual([
      ["cashout", "💸 Вывод средств", "—", -100],
      ["grade", "Алгебра", 5, 999], // порядок внутри дня — как в файле
      ["grade", "Физика", "н", 0]
    ]);
    expect(balance).toBe(899);
  });

  it("экспорт → импорт сохраняет историю как есть", async () => {
    const call = user();
    await addAll(call, [["Алгебра", 5, "2026-10-16"], ["Алгебра", 5], ["Физика", 5], ["Музыка", 3]]);
    await call("POST", "/api/cashout", { amount: 100 });
    const before = (await call("GET", "/api/state")).body;
    const csv = (await call("GET", "/api/export.csv")).body;
    const admin = await unlock(call);
    const after = (await call("POST", "/api/admin/import", { csv }, { admin })).body.state;
    const view = (s) => s.history.map(({ id, ...e }) => e); // eslint-disable-line no-unused-vars
    expect(view(after)).toEqual(view(before));
    expect(after.balance).toBe(before.balance);
  });

  it("импорт без админ-токена — 403, файл без записей — 400 и история не тронута", async () => {
    const call = user();
    await add(call, "А", 5);
    expect((await call("POST", "/api/admin/import", { csv: "a,b\n1,2" })).status).toBe(403);
    const admin = await unlock(call);
    expect((await call("POST", "/api/admin/import", { csv: "a,b\n1,2" }, { admin })).status).toBe(400);
    expect((await call("GET", "/api/state")).body.history).toHaveLength(1);
  });
});
