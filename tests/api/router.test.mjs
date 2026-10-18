// Адаптер Vercel (api/router.mjs) и поведение без базы — так API живёт в Production до этапа 6.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

let handler;
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("FIREBASE_PROJECT_ID", "dany-score-test");
  ({ default: handler } = await import("../../api/router.mjs"));
});
afterAll(() => vi.unstubAllEnvs());

function fakeRes() {
  const res = { headers: {}, statusCode: 0, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (s) => { res.statusCode = s; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}

describe("api/router.mjs", () => {
  it("путь берётся из ?path= (rewrite в vercel.json), без токена — 401, без кеша", async () => {
    const res = fakeRes();
    await handler({ method: "GET", query: { path: "state" }, headers: {}, body: undefined }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized", message: "unauthorized" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("неизвестный путь — 404", async () => {
    const res = fakeRes();
    await handler({ method: "GET", query: { path: "admin/../../etc" }, headers: {}, body: "{" }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("без DATABASE_URL", () => {
  it("withNeonDb отвечает 503 db_not_configured", async () => {
    const { withNeonDb } = await import("../../server/db/client.mjs");
    await expect(withNeonDb("", async () => 1)).rejects.toMatchObject({ status: 503, code: "db_not_configured" });
  });
});
