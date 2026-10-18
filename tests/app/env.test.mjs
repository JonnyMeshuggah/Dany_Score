// /api/env решает, какую версию фронта получит пользователь: без DATA_BACKEND=api — Firestore (Production до этапа 6).
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";

const handler = createRequire(import.meta.url)("../../api/env.js");

function call() {
  let body;
  const res = { setHeader() {}, status() { return res; }, json(b) { body = b; } };
  handler({}, res);
  return body;
}

const saved = process.env.DATA_BACKEND;
afterEach(() => {
  if (saved === undefined) delete process.env.DATA_BACKEND;
  else process.env.DATA_BACKEND = saved;
});

describe("DATA_BACKEND в /api/env", () => {
  it("не задан — firestore", () => {
    delete process.env.DATA_BACKEND;
    expect(call().DATA_BACKEND).toBe("firestore");
  });

  it("api — api; любое другое значение — firestore", () => {
    process.env.DATA_BACKEND = "api";
    expect(call().DATA_BACKEND).toBe("api");
    process.env.DATA_BACKEND = "API ";
    expect(call().DATA_BACKEND).toBe("firestore");
  });
});
