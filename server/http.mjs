// Мини-роутер API. Запрос и ответ — простые объекты, чтобы тесты вызывали API без HTTP-сервера.
// req: { method, path, headers (ключи в нижнем регистре), body }
// ответ: { status, body, headers? }

export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg) => new HttpError(400, "bad_request", msg);
export const notFound = () => new HttpError(404, "not_found");
export const conflict = (msg) => new HttpError(409, "conflict", msg);

// routes: [method, "/path/:param", handler(req, params)]
export function createRouter(routes) {
  const compiled = routes.map(([method, pattern, handler]) => {
    const names = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "/?$");
    return { method, re, names, handler };
  });

  return async function handle(req) {
    try {
      const match = compiled
        .map(r => ({ r, m: r.re.exec(req.path) }))
        .filter(x => x.m);
      if (match.length === 0) throw notFound();
      const found = match.find(x => x.r.method === req.method);
      if (!found) throw new HttpError(405, "method_not_allowed");
      const decode = (v) => { try { return decodeURIComponent(v); } catch { throw badRequest("Некорректный путь"); } };
      const params = Object.fromEntries(found.r.names.map((n, i) => [n, decode(found.m[i + 1])]));
      const res = await found.r.handler(req, params);
      return { status: 200, ...res };
    } catch (err) {
      if (err instanceof HttpError) {
        return { status: err.status, body: { error: err.code, message: err.message } };
      }
      // Подробности — только в лог функции, клиенту не отдаём
      console.error("API error:", err);
      return { status: 500, body: { error: "internal" } };
    }
  };
}

// Проверка входных данных
export function requireInt(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw badRequest(`${name}: ожидается целое число`);
  return value;
}

// id из пути запроса — строка из цифр
export function requireId(value) {
  if (typeof value !== "string" || !/^\d{1,9}$/.test(value) || Number(value) < 1) throw badRequest("id: ожидается число");
  return Number(value);
}

export function requireNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw badRequest(`${name}: ожидается число`);
  }
  return value;
}

export function requireText(value, name, { max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw badRequest(`${name}: ожидается непустая строка до ${max} символов`);
  }
  return value.trim();
}

// "ГГГГ-ММ-ДД", существующая дата
export function requireISODate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${name}: ожидается ГГГГ-ММ-ДД`);
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw badRequest(`${name}: несуществующая дата`);
  }
  return value;
}
