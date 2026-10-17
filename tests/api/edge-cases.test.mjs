// Крайние случаи из ревью этапа 3: общий лимит PIN, сезон при параллельном первом входе,
// битые запросы, большой импорт. Своя база — общий счётчик PIN не мешает другим файлам.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { bpSeasons } from "../../server/db/schema.mjs";
import { createTestDb, createTestApp, clientFor, idToken, newUid, unlock, PIN } from "./helpers.mjs";

let env, app;
beforeAll(async () => {
  env = await createTestDb();
  app = await createTestApp(env.db);
});
afterAll(() => env.close());

describe("запросы", () => {
  it("iat в будущем — 401", async () => {
    const token = await idToken(newUid(), { iat: Math.floor(Date.now() / 1000) + 3600 });
    const res = await app({ method: "GET", path: "/api/state", headers: { authorization: `Bearer ${token}` }, body: {} });
    expect(res.status).toBe(401);
  });

  it("битый %-escape в пути — 400, а не 500", async () => {
    expect((await clientFor(app, newUid())("DELETE", "/api/entries/%E0%A4%A")).status).toBe(400);
  });

  it("параллельные первые запросы нового пользователя создают один сезон", async () => {
    const uid = newUid();
    const call = clientFor(app, uid);
    const results = await Promise.all([1, 2, 3].map(() => call("GET", "/api/state")));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(await env.db.select().from(bpSeasons).where(eq(bpSeasons.userId, uid))).toHaveLength(1);
  });

  it("второй активный сезон база не допускает", async () => {
    const uid = newUid();
    await clientFor(app, uid)("GET", "/api/state");
    await expect(env.db.insert(bpSeasons).values({ userId: uid, number: 2, name: "x", maxLevel: 1, xpPerLevel: 1 }))
      .rejects.toThrow();
  });

  it("10 000 строк импорта вставляются порциями", async () => {
    const call = clientFor(app, newUid());
    const admin = await unlock(call);
    const lines = ['"Дата","Предмет","Оценка","Бонус","Сумма"'];
    for (let i = 0; i < 10000; i++) lines.push('"16.10.2026","Алгебра","4","","1"');
    const res = await call("POST", "/api/admin/import", { csv: lines.join("\n") }, { admin });
    expect(res.status).toBe(200);
    expect(res.body.state.balance).toBe(10000);
  });
});

describe("тело запроса в адаптере Vercel", () => {
  it("строка \"null\", массив и битый JSON не роняют обработчик", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("FIREBASE_PROJECT_ID", "dany-score-test");
    const { default: handler } = await import("../../api/router.mjs");
    for (const body of ["null", "[1]", "{"]) {
      const res = { headers: {}, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
      await handler({ method: "POST", query: { path: "admin/unlock" }, headers: {}, body }, res);
      expect(res.statusCode).toBe(401);
    }
    vi.unstubAllEnvs();
  });
});

// Последний — исчерпывает общий лимит этой базы
describe("общий лимит попыток PIN (перебор с разных аккаунтов)", () => {
  it("после 20 неудач за 15 минут на всех — 429 и для нового аккаунта с верным PIN", async () => {
    for (let u = 0; u < 4; u++) {
      const call = clientFor(app, newUid());
      for (let i = 0; i < 5; i++) expect((await call("POST", "/api/admin/unlock", { pin: "0000" })).status).toBe(403);
    }
    expect((await clientFor(app, newUid())("POST", "/api/admin/unlock", { pin: PIN })).status).toBe(429);
  });
});
