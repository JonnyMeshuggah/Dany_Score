// Клиент API (server/app.mjs) для фронта на Neon — docs/MIGRATION_PLAN.md, этап 5.
// Мутации возвращают { ..., state } — свежее состояние, второй запрос не нужен.
// Токен админки (POST /api/admin/unlock по PIN, 30 минут) хранится только в памяти вкладки.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Тексты для ошибок, у которых сервер не прислал своего сообщения
const MESSAGES = {
  unauthorized: "Сессия истекла — войдите снова",
  forbidden: "Админка закрыта — введите PIN ещё раз",
  db_not_configured: "Сервер ещё не подключён к базе данных",
  admin_not_configured: "Админка на сервере не настроена",
  auth_unavailable: "Сервер входа временно недоступен, попробуйте позже",
  not_found: "Запись не найдена — обновите страницу",
  internal: "Ошибка сервера, попробуйте ещё раз",
  network: "Нет связи с сервером — проверьте интернет"
};

export function createApi({ getIdToken, fetchImpl = (...args) => fetch(...args) }) {
  let adminToken = null;

  async function request(method, path, { body, admin = false, raw = false } = {}) {
    let idToken;
    try {
      idToken = await getIdToken();
    } catch {
      throw new ApiError(401, "unauthorized", MESSAGES.unauthorized);
    }
    const headers = { authorization: `Bearer ${idToken}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (admin) {
      if (!adminToken) throw new ApiError(403, "forbidden", MESSAGES.forbidden);
      headers["x-admin-token"] = adminToken;
    }

    let res;
    try {
      res = await fetchImpl(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, "network", MESSAGES.network);
    }
    if (res.ok) return raw ? res.text() : res.json();

    let data = {};
    try { data = await res.json(); } catch { /* ответ не JSON */ }
    const code = data.error || `http_${res.status}`;
    // Токен админки истёк или подменён — дальше снова нужен PIN
    if (admin && res.status === 403) adminToken = null;
    const message = data.message && data.message !== code ? data.message : MESSAGES[code] ?? `Ошибка сервера (${res.status})`;
    throw new ApiError(res.status, code, message);
  }

  const asAdmin = (method, path, body) => request(method, path, { body, admin: true });

  return {
    get isAdmin() { return adminToken !== null; },
    lockAdmin() { adminToken = null; },
    async unlockAdmin(pin) {
      const res = await request("POST", "/api/admin/unlock", { body: { pin } });
      adminToken = res.token;
      return res;
    },

    getState: () => request("GET", "/api/state"),
    addGrade: ({ date, subject, grade }) => request("POST", "/api/grades", { body: { date, subject, grade } }),
    deleteEntry: (id) => request("DELETE", `/api/entries/${encodeURIComponent(id)}`),
    cashOut: (amount) => request("POST", "/api/cashout", { body: { amount } }),
    claimReward: (id) => request("POST", `/api/bp/rewards/${encodeURIComponent(id)}/claim`),
    exportCSV: () => request("GET", "/api/export.csv", { raw: true }),

    adminBonus: (amount) => asAdmin("POST", "/api/admin/bonus", { amount }),
    importHistory: (csv) => asAdmin("POST", "/api/admin/import", { csv }),
    updateSeason: (season) => asAdmin("PUT", "/api/admin/season", season),
    resetSeason: () => asAdmin("POST", "/api/admin/season/reset", {}),
    addTask: (task) => asAdmin("POST", "/api/admin/tasks", task),
    deleteTask: (id) => asAdmin("DELETE", `/api/admin/tasks/${encodeURIComponent(id)}`),
    addReward: (reward) => asAdmin("POST", "/api/admin/rewards", reward),
    deleteReward: (id) => asAdmin("DELETE", `/api/admin/rewards/${encodeURIComponent(id)}`)
  };
}
