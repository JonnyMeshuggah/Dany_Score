// Операции API над данными пользователя. Каждая мутация — одна транзакция, в которой строка
// пользователя заблокирована (SELECT … FOR UPDATE): параллельные запросы одного пользователя
// выполняются по очереди и видят записи друг друга. Правила наград и боевого пропуска — только
// из src/domain, здесь они не дублируются.
import { and, eq, gte, lt, count, sql } from "drizzle-orm";
import * as t from "./db/schema.mjs";
import { applyGrade } from "../src/domain/grades.js";
import { recalculateHistory, computeBalance } from "../src/domain/rewards.js";
import { levelFromXP } from "../src/domain/battlePass.js";
import { isoToRuDate, compareNewestFirst } from "../src/domain/dates.js";
import { historyToCSV, parseHistoryCSV } from "../src/domain/csv.js";
import { verifyPin, issueAdminToken, ADMIN_TOKEN_TTL_SEC } from "./auth.mjs";
import {
  HttpError, badRequest, notFound, conflict,
  requireInt, requireId, requireNumber, requireText, requireISODate
} from "./http.mjs";

// Дата «сегодня» для выводов, бонусов и наград — по времени семьи, а не по UTC сервера
export const APP_TIME_ZONE = "Europe/Moscow";
export function todayISO(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

// Сезон по умолчанию — как начальное состояние battlePass в src/App.jsx
export const DEFAULT_SEASON = { number: 1, name: "Осенний апгрейд знаний", maxLevel: 10, xpPerLevel: 200 };
export const TASK_TYPES = ["streak_fives", "total_grades_week", "average_score"];
export const REWARD_TYPES = ["money", "badge", "other"];
const MAX_AMOUNT = 10_000_000;
const MAX_IMPORT_BYTES = 1_000_000;
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_FAILURES = 5;
// Общий лимит на всех: аккаунты Firebase можно наплодить, и лимит на uid один не спасает от перебора
const PIN_MAX_FAILURES_GLOBAL = 20;
const PIN_ATTEMPTS_KEEP_MS = 24 * 60 * 60 * 1000;
const PIN_LOCK_KEY = 724001; // ключ pg_advisory_xact_lock для попыток PIN

// ---- Записи: строка БД ↔ запись истории в формате домена (id — порядок внутри дня)
const ruToISO = (ru) => { const [d, m, y] = ru.split("."); return `${y}-${m}-${d}`; };

function toDomainEntry(row) {
  return {
    id: String(row.sortKey),
    dbId: row.id,
    kind: row.kind,
    date: isoToRuDate(row.date),
    subject: row.subject,
    grade: row.grade ?? row.gradeText ?? "—",
    reward: row.reward,
    bonus: row.bonusDesc
  };
}

const toApiEntry = (e) => ({
  id: e.dbId, kind: e.kind, date: e.date, subject: e.subject, grade: e.grade, reward: e.reward, bonus: e.bonus
});

// Вид записи по префиксу предмета — так их различала версия на Firestore
export function kindForSubject(subject) {
  if (subject.startsWith("💸")) return "cashout";
  if (subject.startsWith("🎁")) return "admin_bonus";
  if (subject.startsWith("🏆")) return "bp_reward";
  return "grade";
}

async function loadHistory(tx, uid) {
  const rows = await tx.select().from(t.entries).where(eq(t.entries.userId, uid));
  return rows.map(toDomainEntry).sort(compareNewestFirst);
}

// Новая запись — последняя в своём дне (как Date.now() в id на клиенте)
function nextSortKey(history, now) {
  const max = history.reduce((m, e) => Math.max(m, parseInt(e.id) || 0), 0);
  return Math.max(now.getTime(), max + 1);
}

async function insertEntry(tx, uid, history, now, values) {
  const [row] = await tx.insert(t.entries).values({
    userId: uid, sortKey: nextSortKey(history, now), date: todayISO(now), bonusDesc: "", ...values
  }).returning();
  return row;
}

// ---- Боевой пропуск: состояние в формате домена (src/domain/battlePass.js)
async function activeSeason(tx, uid) {
  const find = () => tx.select().from(t.bpSeasons)
    .where(and(eq(t.bpSeasons.userId, uid), eq(t.bpSeasons.isActive, true))).orderBy(t.bpSeasons.id).limit(1);
  const [season] = await find();
  if (season) return season;
  // Активный сезон у пользователя один — это держит уникальный индекс bp_seasons_active_uq
  await tx.insert(t.bpSeasons).values({ userId: uid, ...DEFAULT_SEASON }).onConflictDoNothing();
  return (await find())[0];
}

async function loadBattlePass(tx, uid) {
  const season = await activeSeason(tx, uid);
  const bySeason = (table) => and(eq(table.userId, uid), eq(table.seasonId, season.id));
  const [tasks, rewards, completions, claims] = await Promise.all([
    tx.select().from(t.bpTasks).where(eq(t.bpTasks.seasonId, season.id)).orderBy(t.bpTasks.id),
    tx.select().from(t.bpRewards).where(eq(t.bpRewards.seasonId, season.id)).orderBy(t.bpRewards.level, t.bpRewards.id),
    tx.select().from(t.bpTaskCompletions).where(bySeason(t.bpTaskCompletions)),
    tx.select().from(t.bpRewardClaims).where(bySeason(t.bpRewardClaims))
  ]);
  const xp = completions.reduce((s, c) => s + c.xp, 0);
  return {
    seasonId: season.id,
    season: season.number,
    seasonName: season.name,
    maxLevel: season.maxLevel,
    xpPerLevel: season.xpPerLevel,
    xp,
    level: levelFromXP(xp, season),
    tasks: tasks.map(x => ({ id: x.id, name: x.name, xp: x.xp, type: x.type, ...(x.target != null && { target: x.target }) })),
    rewards: rewards.map(x => ({
      id: x.id, level: x.level, text: x.text, type: x.type,
      ...(x.amount != null && { amount: x.amount }),
      ...(x.badgeNumber != null && { badgeNumber: x.badgeNumber })
    })),
    completedTasks: completions.filter(c => c.taskId != null).map(c => c.taskId),
    claimedRewards: claims.filter(c => c.rewardId != null).map(c => c.rewardId),
    badges: [...new Set(claims.filter(c => c.badgeNumber != null).map(c => c.badgeNumber))].sort((a, b) => a - b)
  };
}

// ---- Транзакции
async function ensureUser(tx, user) {
  await tx.insert(t.users).values({ id: user.uid, email: user.email }).onConflictDoNothing();
}

async function lockUser(tx, user) {
  await ensureUser(tx, user);
  await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.id, user.uid)).for("update");
}

export async function buildState(tx, uid) {
  const history = await loadHistory(tx, uid);
  const battlePass = await loadBattlePass(tx, uid);
  delete battlePass.seasonId; // внутренний id, клиенту не нужен
  return { balance: computeBalance(history), history: history.map(toApiEntry), battlePass };
}

// Мутация возвращает свой результат и свежее состояние — клиенту не нужен второй запрос
function mutate(db, user, fn) {
  return db.transaction(async tx => {
    await lockUser(tx, user);
    const result = await fn(tx, user.uid);
    return { ...result, state: await buildState(tx, user.uid) };
  });
}

// ---- Пользователь
// Чтение тоже под блокировкой: первый запрос создаёт сезон по умолчанию
export function getState(db, user) {
  return db.transaction(async tx => {
    await lockUser(tx, user);
    return buildState(tx, user.uid);
  });
}

export function addGrade(db, user, body, now) {
  const date = requireISODate(body.date, "date");
  const subject = requireText(body.subject, "subject", { max: 100 });
  const grade = requireInt(body.grade, "grade", { min: 2, max: 5 });
  return mutate(db, user, async (tx, uid) => {
    const history = await loadHistory(tx, uid);
    const bp = await loadBattlePass(tx, uid);
    const sortKey = nextSortKey(history, now);
    const { entry, tasks } = applyGrade(history, bp, { id: String(sortKey), date: isoToRuDate(date), subject, grade }, now);
    const [row] = await tx.insert(t.entries).values({
      userId: uid, date, sortKey, kind: "grade", subject, grade, reward: entry.reward, bonusDesc: entry.bonus
    }).returning();
    if (tasks.length > 0) {
      await tx.insert(t.bpTaskCompletions)
        .values(tasks.map(task => ({ userId: uid, seasonId: bp.seasonId, taskId: task.id, xp: task.xp || 100 })))
        .onConflictDoNothing();
    }
    const xp = bp.xp + tasks.reduce((s, task) => s + (task.xp || 100), 0);
    return {
      entry: toApiEntry(toDomainEntry(row)),
      completedTasks: tasks.map(task => task.id),
      levelUp: levelFromXP(xp, bp) > bp.level
    };
  });
}

export function deleteEntry(db, user, id) {
  const entryId = requireId(id);
  return mutate(db, user, async (tx, uid) => {
    const [row] = await tx.select().from(t.entries)
      .where(and(eq(t.entries.id, entryId), eq(t.entries.userId, uid)));
    if (!row) throw notFound();
    await tx.delete(t.entries).where(eq(t.entries.id, entryId));
    // Бонусы зависят только от записей того же дня — пересчитываем один день
    const dayRows = await tx.select().from(t.entries)
      .where(and(eq(t.entries.userId, uid), eq(t.entries.date, row.date)));
    const before = new Map(dayRows.map(r => [r.id, r]));
    for (const e of recalculateHistory(dayRows.map(toDomainEntry))) {
      const old = before.get(e.dbId);
      if (old.reward !== e.reward || old.bonusDesc !== e.bonus) {
        await tx.update(t.entries).set({ reward: e.reward, bonusDesc: e.bonus }).where(eq(t.entries.id, e.dbId));
      }
    }
    return { deleted: entryId };
  });
}

export function cashOut(db, user, body, now) {
  const amount = requireInt(body.amount, "amount", { min: 1, max: MAX_AMOUNT });
  return mutate(db, user, async (tx, uid) => {
    const history = await loadHistory(tx, uid);
    if (amount > computeBalance(history)) throw conflict("Сумма больше баланса");
    const row = await insertEntry(tx, uid, history, now, {
      kind: "cashout", subject: "💸 Вывод средств", gradeText: "—", reward: -amount, bonusDesc: "Частичный вывод"
    });
    return { entry: toApiEntry(toDomainEntry(row)) };
  });
}

export function claimReward(db, user, id, now) {
  const rewardId = requireId(id);
  return mutate(db, user, async (tx, uid) => {
    const bp = await loadBattlePass(tx, uid);
    const reward = bp.rewards.find(r => r.id === rewardId);
    if (!reward) throw notFound();
    if (bp.claimedRewards.includes(rewardId)) throw conflict("Награда уже получена");
    if (bp.level < reward.level) throw conflict(`Эта награда доступна на уровне ${reward.level}`);
    let entryId = null;
    if (reward.type === "money" && reward.amount) {
      const history = await loadHistory(tx, uid);
      const row = await insertEntry(tx, uid, history, now, {
        kind: "bp_reward", subject: `🏆 Награда BP (Ур.${reward.level})`, gradeText: "—",
        reward: reward.amount, bonusDesc: reward.text
      });
      entryId = row.id;
    }
    await tx.insert(t.bpRewardClaims).values({
      userId: uid, seasonId: bp.seasonId, rewardId, entryId,
      badgeNumber: reward.type === "badge" ? reward.badgeNumber ?? null : null
    });
    return { claimed: rewardId };
  });
}

export async function exportCSV(db, user) {
  const history = await db.transaction(async tx => {
    await ensureUser(tx, user);
    return loadHistory(tx, user.uid);
  });
  return historyToCSV(history);
}

// ---- Админка
export async function unlockAdmin(db, user, body, env, now) {
  const pin = body.pin;
  if (typeof pin !== "string" || pin.length === 0 || pin.length > 64) throw badRequest("pin: ожидается строка");
  if (!env.ADMIN_PIN_HASH) throw new HttpError(503, "admin_not_configured");
  // Счётчик неудач — в БД: память serverless-функции не переживает вызов.
  // Попытка записывается в той же транзакции, ошибка бросается уже после фиксации.
  const ok = await db.transaction(async tx => {
    await ensureUser(tx, user);
    // Все попытки входа — по очереди, иначе параллельные запросы обходят общий лимит
    await tx.execute(sql`select pg_advisory_xact_lock(${PIN_LOCK_KEY})`);
    await tx.delete(t.adminUnlockAttempts)
      .where(lt(t.adminUnlockAttempts.at, new Date(now.getTime() - PIN_ATTEMPTS_KEEP_MS)));
    const recentFailures = and(
      eq(t.adminUnlockAttempts.ok, false),
      gte(t.adminUnlockAttempts.at, new Date(now.getTime() - PIN_WINDOW_MS))
    );
    const [{ mine }] = await tx.select({ mine: count() }).from(t.adminUnlockAttempts)
      .where(and(recentFailures, eq(t.adminUnlockAttempts.userId, user.uid)));
    const [{ all }] = await tx.select({ all: count() }).from(t.adminUnlockAttempts).where(recentFailures);
    if (mine >= PIN_MAX_FAILURES || all >= PIN_MAX_FAILURES_GLOBAL) return null;
    const valid = verifyPin(pin, env.ADMIN_PIN_HASH);
    await tx.insert(t.adminUnlockAttempts).values({ userId: user.uid, ok: valid, at: now });
    return valid;
  });
  if (ok === null) throw new HttpError(429, "too_many_attempts", "Слишком много попыток, подождите 15 минут");
  if (!ok) throw new HttpError(403, "wrong_pin", "Неверный код доступа");
  return { token: await issueAdminToken(user.uid, env.ADMIN_TOKEN_SECRET), expiresIn: ADMIN_TOKEN_TTL_SEC };
}

export function adminBonus(db, user, body, now) {
  const amount = requireInt(body.amount, "amount", { min: 1, max: MAX_AMOUNT });
  return mutate(db, user, async (tx, uid) => {
    const history = await loadHistory(tx, uid);
    const row = await insertEntry(tx, uid, history, now, {
      kind: "admin_bonus", subject: "🎁 Бонус от администратора", gradeText: "—", reward: amount
    });
    return { entry: toApiEntry(toDomainEntry(row)) };
  });
}

export function updateSeason(db, user, body) {
  const values = {
    number: requireInt(body.season, "season", { min: 1, max: 1000 }),
    name: requireText(body.seasonName, "seasonName", { max: 100 }),
    maxLevel: requireInt(body.maxLevel, "maxLevel", { min: 1, max: 1000 }),
    xpPerLevel: requireInt(body.xpPerLevel, "xpPerLevel", { min: 1, max: 1_000_000 })
  };
  return mutate(db, user, async (tx, uid) => {
    const season = await activeSeason(tx, uid);
    await tx.update(t.bpSeasons).set(values).where(eq(t.bpSeasons.id, season.id));
    return {};
  });
}

export function addTask(db, user, body) {
  const name = requireText(body.name, "name", { max: 200 });
  const xp = requireInt(body.xp, "xp", { min: 1, max: 1_000_000 });
  if (!TASK_TYPES.includes(body.type)) throw badRequest(`type: одно из ${TASK_TYPES.join(", ")}`);
  const target = body.target == null || body.target === "" ? null : requireNumber(body.target, "target", { min: 0, max: 1000 });
  return mutate(db, user, async (tx, uid) => {
    const season = await activeSeason(tx, uid);
    const [task] = await tx.insert(t.bpTasks).values({ seasonId: season.id, name, xp, type: body.type, target }).returning();
    return { id: task.id };
  });
}

export function addReward(db, user, body) {
  const level = requireInt(body.level, "level", { min: 0, max: 1000 });
  const text = requireText(body.text, "text", { max: 200 });
  if (!REWARD_TYPES.includes(body.type)) throw badRequest(`type: одно из ${REWARD_TYPES.join(", ")}`);
  const amount = body.type === "money" && body.amount != null && body.amount !== ""
    ? requireInt(body.amount, "amount", { min: 1, max: MAX_AMOUNT }) : null;
  const badgeNumber = body.type === "badge" ? requireInt(body.badgeNumber, "badgeNumber", { min: 1, max: 5 }) : null;
  return mutate(db, user, async (tx, uid) => {
    const season = await activeSeason(tx, uid);
    const [reward] = await tx.insert(t.bpRewards)
      .values({ seasonId: season.id, level, text, type: body.type, amount, badgeNumber }).returning();
    return { id: reward.id };
  });
}

// Удалить задание или награду активного сезона. Полученные XP и бейджи остаются (как в Firestore).
function deleteFromSeason(table) {
  return (db, user, id) => {
    const itemId = requireId(id);
    return mutate(db, user, async (tx, uid) => {
      const season = await activeSeason(tx, uid);
      const deleted = await tx.delete(table)
        .where(and(eq(table.id, itemId), eq(table.seasonId, season.id))).returning({ id: table.id });
      if (deleted.length === 0) throw notFound();
      return { deleted: itemId };
    });
  };
}
export const deleteTask = deleteFromSeason(t.bpTasks);
export const deleteReward = deleteFromSeason(t.bpRewards);

// Сброс сезона: задания, награды и прогресс. Деньги в истории не трогаются (как в Firestore).
export function resetSeason(db, user) {
  return mutate(db, user, async (tx, uid) => {
    const season = await activeSeason(tx, uid);
    await tx.delete(t.bpTaskCompletions).where(eq(t.bpTaskCompletions.seasonId, season.id));
    await tx.delete(t.bpRewardClaims).where(eq(t.bpRewardClaims.seasonId, season.id));
    await tx.delete(t.bpTasks).where(eq(t.bpTasks.seasonId, season.id));
    await tx.delete(t.bpRewards).where(eq(t.bpRewards.seasonId, season.id));
    return {};
  });
}

// Импорт CSV заменяет всю историю (как «Загрузить историю из файла и заменить текущую?»)
export function importHistory(db, user, body, now) {
  if (typeof body.csv !== "string" || body.csv.length > MAX_IMPORT_BYTES) throw badRequest("csv: ожидается текст файла");
  const parsed = parseHistoryCSV(body.csv, now.getTime());
  if (parsed.length === 0) throw badRequest("В файле нет записей с корректной датой (ДД.ММ.ГГГГ)");
  const rows = parsed.map(e => {
    if (!Number.isInteger(e.reward) || Math.abs(e.reward) > MAX_AMOUNT) throw badRequest(`Некорректная сумма: ${e.reward}`);
    const date = ruToISO(e.date);
    requireISODate(date, "date");
    const numeric = typeof e.grade === "number";
    const subject = e.subject ?? "";
    return {
      date, sortKey: Number(e.id), kind: kindForSubject(subject), subject,
      grade: numeric ? e.grade : null, gradeText: numeric ? null : String(e.grade),
      reward: e.reward, bonusDesc: e.bonus
    };
  });
  return mutate(db, user, async (tx, uid) => {
    await tx.delete(t.entries).where(eq(t.entries.userId, uid));
    // Порциями: у Postgres лимит 65535 параметров на запрос
    for (let i = 0; i < rows.length; i += 1000) {
      await tx.insert(t.entries).values(rows.slice(i, i + 1000).map(r => ({ userId: uid, ...r })));
    }
    return { imported: rows.length };
  });
}
