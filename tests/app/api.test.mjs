// Клиент API фронта: заголовки, тела, ошибки, токен админки.
import { describe, it, expect, vi } from "vitest";
import { createApi, ApiError } from "../../src/app/api.js";

const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

function setup(responses = []) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => queue.shift() ?? json(200, {}));
  const api = createApi({ getIdToken: async () => "id-token", fetchImpl });
  return { api, fetchImpl };
}

describe("запросы", () => {
  it("ID-токен в Authorization, тело — JSON", async () => {
    const { api, fetchImpl } = setup([json(200, { entry: {}, state: {} })]);
    await api.addGrade({ date: "2026-10-18", subject: "Алгебра", grade: 5, extra: "x" });
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/grades");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer id-token");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ date: "2026-10-18", subject: "Алгебра", grade: 5 });
  });

  it("GET без тела и без content-type; экспорт возвращает текст", async () => {
    const { api, fetchImpl } = setup([{ ok: true, status: 200, text: async () => "csv-text" }]);
    expect(await api.exportCSV()).toBe("csv-text");
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers["content-type"]).toBeUndefined();
  });

  it("id в пути экранируется", async () => {
    const { api, fetchImpl } = setup();
    await api.deleteEntry("1/../x");
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/entries/1%2F..%2Fx");
  });
});

describe("ошибки", () => {
  it("сообщение сервера показывается как есть", async () => {
    const { api } = setup([json(409, { error: "conflict", message: "Сумма больше баланса" })]);
    await expect(api.cashOut(100)).rejects.toMatchObject({ status: 409, code: "conflict", message: "Сумма больше баланса" });
  });

  it("без сообщения — русский текст по коду, неизвестный код — общий", async () => {
    const { api } = setup([json(401, { error: "unauthorized", message: "unauthorized" }), json(502, {})]);
    await expect(api.getState()).rejects.toThrow("Сессия истекла — войдите снова");
    await expect(api.getState()).rejects.toThrow("Ошибка сервера (502)");
  });

  it("нет сети — понятная ошибка", async () => {
    const api = createApi({ getIdToken: async () => "t", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    await expect(api.getState()).rejects.toMatchObject({ code: "network" });
  });

  it("нет пользователя — unauthorized без запроса", async () => {
    const fetchImpl = vi.fn();
    const api = createApi({ getIdToken: () => { throw new Error("not signed in"); }, fetchImpl });
    await expect(api.getState()).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("админка", () => {
  it("без PIN админ-запрос не уходит", async () => {
    const { api, fetchImpl } = setup();
    await expect(api.adminBonus(100)).rejects.toMatchObject({ code: "forbidden" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("после unlock токен идёт в X-Admin-Token; 403 сбрасывает его", async () => {
    const { api, fetchImpl } = setup([
      json(200, { token: "adm", expiresIn: 1800 }),
      json(200, { state: {} }),
      json(403, { error: "forbidden" })
    ]);
    await api.unlockAdmin("123456");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ pin: "123456" });
    expect(api.isAdmin).toBe(true);
    await api.adminBonus(500);
    expect(fetchImpl.mock.calls[1][1].headers["x-admin-token"]).toBe("adm");
    await expect(api.resetSeason()).rejects.toMatchObject({ code: "forbidden" });
    expect(api.isAdmin).toBe(false);
  });

  it("неверный PIN — токена нет, сообщение сервера", async () => {
    const { api } = setup([json(403, { error: "wrong_pin", message: "Неверный код доступа" })]);
    await expect(api.unlockAdmin("1")).rejects.toThrow("Неверный код доступа");
    expect(api.isAdmin).toBe(false);
  });

  it("ответ unlock после lockAdmin (выход во время запроса) токен не ставит", async () => {
    let release;
    const fetchImpl = vi.fn(() => new Promise(r => { release = () => r(json(200, { token: "old" })); }));
    const api = createApi({ getIdToken: async () => "t", fetchImpl });
    const pending = api.unlockAdmin("123456");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    api.lockAdmin();
    release();
    await pending;
    expect(api.isAdmin).toBe(false);
  });

  it("lockAdmin закрывает админку", async () => {
    const { api } = setup([json(200, { token: "adm" })]);
    await api.unlockAdmin("123456");
    api.lockAdmin();
    expect(api.isAdmin).toBe(false);
  });
});
