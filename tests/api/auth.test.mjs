import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair } from "jose";
import { createTestDb, createTestApp, clientFor, idToken, newUid, unlock, PIN } from "./helpers.mjs";

let env, app;
beforeAll(async () => {
  env = await createTestDb();
  app = await createTestApp(env.db);
});
afterAll(() => env.close());

const get = (headers) => app({ method: "GET", path: "/api/state", headers, body: {} });

describe("вход по ID-токену Firebase", () => {
  it("без токена — 401", async () => {
    expect((await get({})).status).toBe(401);
  });

  it("с действующим токеном — 200 и пустое состояние нового пользователя", async () => {
    const res = await clientFor(app, newUid())("GET", "/api/state");
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(0);
    expect(res.body.history).toEqual([]);
    expect(res.body.battlePass).toMatchObject({ season: 1, xp: 0, level: 0, maxLevel: 10, xpPerLevel: 200, tasks: [] });
  });

  const bad = {
    "чужой проект (aud)": { aud: "other-project" },
    "чужой издатель (iss)": { iss: "https://securetoken.google.com/other-project" },
    "просроченный": { exp: Math.floor(Date.now() / 1000) - 60 },
    "auth_time в будущем": { claims: { auth_time: Math.floor(Date.now() / 1000) + 3600 } }
  };
  for (const [name, overrides] of Object.entries(bad)) {
    it(`${name} — 401`, async () => {
      const token = await idToken(newUid(), overrides);
      expect((await get({ authorization: `Bearer ${token}` })).status).toBe(401);
    });
  }

  it("подписанный чужим ключом — 401", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const token = await idToken(newUid(), { key: privateKey });
    expect((await get({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("неизвестный путь — 404, неверный метод — 405", async () => {
    const call = clientFor(app, newUid());
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("POST", "/api/state")).status).toBe(405);
  });
});

describe("админка по PIN", () => {
  it("админ-эндпоинты без админ-токена — 403", async () => {
    const res = await clientFor(app, newUid())("POST", "/api/admin/bonus", { amount: 100 });
    expect(res.status).toBe(403);
  });

  it("верный PIN даёт токен на 30 минут, и с ним бонус начисляется", async () => {
    const call = clientFor(app, newUid());
    const res = await call("POST", "/api/admin/unlock", { pin: PIN });
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(1800);
    const bonus = await call("POST", "/api/admin/bonus", { amount: 300 }, { admin: res.body.token });
    expect(bonus.status).toBe(200);
    expect(bonus.body.state.balance).toBe(300);
  });

  it("админ-токен одного пользователя не подходит другому", async () => {
    const token = await unlock(clientFor(app, newUid()));
    const res = await clientFor(app, newUid())("POST", "/api/admin/bonus", { amount: 100 }, { admin: token });
    expect(res.status).toBe(403);
  });

  it("неверный PIN — 403, после 5 неудач за 15 минут — 429 даже с верным", async () => {
    const call = clientFor(app, newUid());
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/api/admin/unlock", { pin: "0000" })).status).toBe(403);
    }
    expect((await call("POST", "/api/admin/unlock", { pin: PIN })).status).toBe(429);
  });

  it("через 15 минут попытки снова разрешены", async () => {
    let t = new Date("2026-10-17T12:00:00Z").getTime();
    const timedApp = await createTestApp(env.db, { now: () => new Date(t) });
    const call = clientFor(timedApp, newUid());
    for (let i = 0; i < 5; i++) await call("POST", "/api/admin/unlock", { pin: "0000" });
    expect((await call("POST", "/api/admin/unlock", { pin: PIN })).status).toBe(429);
    t += 16 * 60 * 1000;
    expect((await call("POST", "/api/admin/unlock", { pin: PIN })).status).toBe(200);
  });
});
