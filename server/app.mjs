// Маршруты API (docs/MIGRATION_PLAN.md, «API»). Зависимости передаются снаружи:
// в Vercel — Neon и ключи Google (api/router.mjs), в тестах — PGlite и локальный ключ.
//   withDb(fn)        — выполнить fn(db) с подключением к базе
//   verifyToken(tok)  — ID-токен Firebase → { uid, email }
//   env               — ADMIN_PIN_HASH, ADMIN_TOKEN_SECRET
import { createRouter } from "./http.mjs";
import { requireUser, requireAdmin } from "./auth.mjs";
import * as s from "./services.mjs";

export function createApp({ withDb, verifyToken, env, now = () => new Date() }) {
  // Токен проверяется до подключения к базе: без входа — 401, даже если база не настроена
  const user = (fn) => async (req, params) => {
    const u = await requireUser(req, verifyToken);
    return withDb(db => fn(db, u, req, params));
  };
  const admin = (fn) => async (req, params) => {
    const u = await requireUser(req, verifyToken);
    await requireAdmin(req, u.uid, env.ADMIN_TOKEN_SECRET);
    return withDb(db => fn(db, u, req, params));
  };
  const json = (fn) => async (...args) => ({ body: await fn(...args) });

  return createRouter([
    ["GET", "/api/state", user(json((db, u) => s.getState(db, u)))],
    ["POST", "/api/grades", user(json((db, u, req) => s.addGrade(db, u, req.body, now())))],
    ["DELETE", "/api/entries/:id", user(json((db, u, req, p) => s.deleteEntry(db, u, p.id)))],
    ["POST", "/api/cashout", user(json((db, u, req) => s.cashOut(db, u, req.body, now())))],
    ["POST", "/api/bp/rewards/:id/claim", user(json((db, u, req, p) => s.claimReward(db, u, p.id, now())))],
    ["GET", "/api/export.csv", user(async (db, u) => ({
      body: await s.exportCSV(db, u),
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="history_${s.todayISO(now())}.csv"`
      }
    }))],

    ["POST", "/api/admin/unlock", user(json((db, u, req) => s.unlockAdmin(db, u, req.body, env, now())))],
    ["POST", "/api/admin/bonus", admin(json((db, u, req) => s.adminBonus(db, u, req.body, now())))],
    ["POST", "/api/admin/import", admin(json((db, u, req) => s.importHistory(db, u, req.body, now())))],
    ["PUT", "/api/admin/season", admin(json((db, u, req) => s.updateSeason(db, u, req.body)))],
    ["POST", "/api/admin/season/reset", admin(json((db, u) => s.resetSeason(db, u)))],
    ["POST", "/api/admin/season/launch", admin(json((db, u) => s.launchPresetSeason(db, u)))],
    ["POST", "/api/admin/tasks", admin(json((db, u, req) => s.addTask(db, u, req.body)))],
    ["DELETE", "/api/admin/tasks/:id", admin(json((db, u, req, p) => s.deleteTask(db, u, p.id)))],
    ["POST", "/api/admin/rewards", admin(json((db, u, req) => s.addReward(db, u, req.body)))],
    ["DELETE", "/api/admin/rewards/:id", admin(json((db, u, req, p) => s.deleteReward(db, u, p.id)))]
  ]);
}
