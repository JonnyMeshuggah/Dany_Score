// Перенос данных Firestore → Neon (docs/MIGRATION_PLAN.md, этап 4). Вход — JSON-бэкап
// scripts/export-firestore.mjs. planDump() только разбирает и сверяет, ничего не пишет;
// applyUser() заменяет данные одного пользователя в транзакции и сверяет результат через buildState —
// то же состояние, что отдаёт GET /api/state. При расхождении транзакция откатывается.
import { eq } from "drizzle-orm";
import * as t from "../db/schema.mjs";
import { buildState, kindForSubject, todayISO, DEFAULT_SEASON } from "../services.mjs";
import { levelFromXP } from "../../src/domain/battlePass.js";

export const CORRECTION_SUBJECT = "🎁 Корректировка при переезде";
const MAX_AMOUNT = 10_000_000;
const INSERT_CHUNK = 1000; // у Postgres лимит 65535 параметров на запрос

// "Д.М.ГГГГ" → "ГГГГ-ММ-ДД"; null, если это не существующая дата
export function ruDateToISO(value) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// Целое из числа или строки "123" в пределах integer Postgres; иначе null
const INT4_MAX = 2 ** 31 - 1;
function toInt(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && Math.abs(n) <= INT4_MAX ? n : null;
}
// Номер бейджа — smallint в Postgres
const toSmallInt = (value) => { const n = toInt(value); return n !== null && Math.abs(n) <= 32767 ? n : null; };

function toNumber(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

const text = (value, fallback = "") => (value == null ? fallback : String(value));

// ---- История → строки entries
function planEntries(history, errors, warnings) {
  const rows = [];
  history.forEach((h, i) => {
    const where = `history[${i}]`;
    if (!h || typeof h !== "object") return errors.push(`${where}: не объект`);
    const date = ruDateToISO(h.date);
    if (!date) return errors.push(`${where}: дата «${h.date}» не в формате ДД.ММ.ГГГГ`);
    const subject = text(h.subject);
    let reward = toInt(h.reward);
    if (reward === null) return errors.push(`${where} (${h.date}, ${subject}): сумма «${h.reward}» не целое число`);
    if (Math.abs(reward) > MAX_AMOUNT) return errors.push(`${where} (${h.date}, ${subject}): сумма ${reward} вне диапазона`);
    if (typeof h.reward !== "number") warnings.push(`${where} (${h.date}, ${subject}): сумма-строка «${h.reward}» → ${reward}`);
    if (!subject) warnings.push(`${where} (${h.date}): нет предмета`);
    const g = toInt(h.grade);
    const numeric = [2, 3, 4, 5].includes(g);
    // Как compareNewestFirst в src/domain/dates.js: parseInt(id) || 0
    const id = parseInt(h.id) || 0;
    if (h.id != null && String(id) !== String(h.id)) warnings.push(`${where} (${h.date}, ${subject}): id «${h.id}» читается как ${id}`);
    rows.push({
      id: Number.isSafeInteger(id) && id > 0 ? id : 0,
      index: i,
      date,
      kind: kindForSubject(subject),
      subject,
      grade: numeric ? g : null,
      gradeText: numeric ? null : text(h.grade, "—"),
      reward,
      bonusDesc: text(h.bonus)
    });
  });

  // Порядок внутри дня — compareNewestFirst (src/domain/dates.js): id-таймштамп по убыванию, при равных
  // (в т.ч. записи без id — выводы, id 0) — порядок массива. По нему же доменная логика считает бонусы
  // дня и пересчитывает их при удалении. Firestore-версия показывала массив как есть и сортировала так
  // только после добавления оценки или бонуса: вывод, добавленный в начало массива, до этого был
  // сверху дня, а после переезда — внизу дня, как после следующей оценки в старой версии. Суммы те же.
  // В Neon порядок задаёт только sortKey, поэтому ключи дня строго возрастают снизу вверх:
  // sortKey = max(id, ключ записи ниже + 1). Уникальные id сохраняются, записи без id получают 1, 2, …,
  // повторы раздвигаются (с предупреждением).
  const byDay = new Map();
  for (const r of rows) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
  for (const day of byDay.values()) {
    day.sort((a, b) => b.id - a.id || a.index - b.index);
    let below = 0;
    for (let i = day.length - 1; i >= 0; i--) {
      const r = day[i];
      r.sortKey = Math.max(r.id, below + 1);
      if (r.id > 0 && r.sortKey !== r.id) warnings.push(`history[${r.index}] (${r.subject}): id ${r.id} → sortKey ${r.sortKey}, чтобы сохранить порядок дня`);
      below = r.sortKey;
    }
  }

  for (const r of rows) {
    delete r.id;
    delete r.index;
  }
  return rows;
}

// ---- battlePass → сезон, задания, награды, отметки. Ссылки — индексы в tasks/rewards.
function planBattlePass(bp, errors, warnings) {
  if (bp == null) {
    return { season: { ...DEFAULT_SEASON }, tasks: [], rewards: [], completions: [], claims: [], storedXp: 0, storedBadges: [] };
  }
  if (typeof bp !== "object") {
    errors.push("battlePass: не объект");
    return null;
  }
  // Некорректное значение заменяется — с предупреждением; отсутствующее — молча
  const orDefault = (where, value, parsed, fallback) => {
    if (parsed !== null) return parsed;
    if (value != null && value !== "") warnings.push(`${where} «${value}» некорректно — будет ${fallback}`);
    return fallback;
  };
  // Как в src/App.jsx: недостающие поля берутся из начального состояния
  const xpPerLevel = toInt(bp.xpPerLevel);
  const season = {
    number: orDefault("battlePass.season", bp.season, toInt(bp.season), DEFAULT_SEASON.number),
    name: orDefault("battlePass.seasonName", bp.seasonName,
      typeof bp.seasonName === "string" ? bp.seasonName : null, DEFAULT_SEASON.name),
    maxLevel: orDefault("battlePass.maxLevel", bp.maxLevel, toInt(bp.maxLevel), DEFAULT_SEASON.maxLevel),
    xpPerLevel: orDefault("battlePass.xpPerLevel", bp.xpPerLevel, xpPerLevel > 0 ? xpPerLevel : null, DEFAULT_SEASON.xpPerLevel)
  };

  const list = (name) => {
    if (bp[name] == null) return [];
    if (Array.isArray(bp[name])) return bp[name];
    errors.push(`battlePass.${name}: не массив`);
    return [];
  };

  const tasks = [], taskByKey = new Map();
  list("tasks").forEach((x, i) => {
    const where = `battlePass.tasks[${i}]`;
    const xp = toInt(x?.xp);
    if (xp === null) return errors.push(`${where}: xp «${x?.xp}» не целое число`);
    const key = String(x.id);
    if (taskByKey.has(key)) return warnings.push(`${where}: повтор id ${key} — пропущено`);
    taskByKey.set(key, tasks.length);
    // target || значение по умолчанию — как в src/domain/battlePass.js: 0 и пусто означают «по умолчанию»
    const target = orDefault(`${where}.target`, x.target, toNumber(x.target), null) || null;
    tasks.push({ name: text(x.name), type: text(x.type), target, xp });
  });

  const rewards = [], rewardByKey = new Map();
  list("rewards").forEach((x, i) => {
    const where = `battlePass.rewards[${i}]`;
    const level = toInt(x?.level);
    if (level === null) return errors.push(`${where}: level «${x?.level}» не целое число`);
    const key = String(x.id);
    if (rewardByKey.has(key)) return warnings.push(`${where}: повтор id ${key} — пропущено`);
    rewardByKey.set(key, rewards.length);
    const amount = orDefault(`${where}.amount`, x.amount, toInt(x.amount), null);
    if (x.type === "money" && !amount) warnings.push(`${where}: денежная награда без суммы — при получении денег не даст`);
    const badgeNumber = orDefault(`${where}.badgeNumber`, x.badgeNumber, toSmallInt(x.badgeNumber), null);
    rewards.push({ level, text: text(x.text), type: text(x.type), amount, badgeNumber });
  });

  const completions = [], doneTasks = new Set();
  for (const id of list("completedTasks")) {
    const ref = taskByKey.get(String(id));
    if (ref === undefined) {
      warnings.push(`battlePass.completedTasks: задания ${id} нет — его XP попадёт в сверку XP`);
    } else if (!doneTasks.has(ref)) {
      doneTasks.add(ref);
      completions.push({ taskRef: ref, xp: tasks[ref].xp });
    }
  }

  const rawBadges = list("badges");
  for (const b of rawBadges) if (toSmallInt(b) === null) warnings.push(`battlePass.badges: «${b}» некорректно — не переносится`);
  const storedBadges = [...new Set(rawBadges.map(toSmallInt).filter(n => n !== null))].sort((a, b) => a - b);
  const claims = [], claimed = new Set();
  for (const id of list("claimedRewards")) {
    const ref = rewardByKey.get(String(id));
    if (ref === undefined) {
      warnings.push(`battlePass.claimedRewards: награды ${id} нет — отметка не переносится`);
      continue;
    }
    if (claimed.has(ref)) continue;
    claimed.add(ref);
    const r = rewards[ref];
    let badgeNumber = r.type === "badge" ? r.badgeNumber : null;
    // В Firestore бейдж хранится отдельно от отметки — переносим ровно тот набор, что видел пользователь
    if (badgeNumber !== null && !storedBadges.includes(badgeNumber)) {
      warnings.push(`battlePass: награда ${id} получена, но бейджа ${badgeNumber} нет в badges — бейдж не переносится`);
      badgeNumber = null;
    }
    claims.push({ rewardRef: ref, badgeNumber });
  }

  let storedXp = toInt(bp.xp);
  if (storedXp === null) {
    if (bp.xp != null) warnings.push(`battlePass.xp «${bp.xp}» не целое число — считается 0`);
    storedXp = 0;
  }
  const storedLevel = toInt(bp.level);
  if (storedLevel !== null && storedLevel !== levelFromXP(storedXp, season)) {
    warnings.push(`battlePass.level ${storedLevel} не соответствует XP ${storedXp} — будет ${levelFromXP(storedXp, season)}`);
  }
  return { season, tasks, rewards, completions, claims, storedXp, storedBadges };
}

// ---- Один документ users/{uid} → план записи и ожидаемое состояние
export function planUser(doc, { now = new Date(), reconcile = false } = {}) {
  const errors = [], warnings = [];
  const data = doc?.data;
  const uid = typeof doc?.id === "string" ? doc.id : "";
  if (!uid) errors.push("нет id документа");
  if (!data || typeof data !== "object") errors.push("пустой документ");
  if (doc?.subcollections) warnings.push(`подколлекции не переносятся: ${Object.keys(doc.subcollections).join(", ")}`);

  const rawHistory = data?.history ?? [];
  if (!Array.isArray(rawHistory)) errors.push("history: не массив");
  const entries = planEntries(Array.isArray(rawHistory) ? rawHistory : [], errors, warnings);
  const bp = planBattlePass(data?.battlePass, errors, warnings);

  // Без balance допустим только пустой документ. При непустой истории это повреждение:
  // корректировка «до нуля» скрыла бы потерю денег, поэтому — ошибка, --reconcile её не закрывает.
  const computedBalance = entries.reduce((s, e) => s + e.reward, 0);
  let storedBalance = data?.balance;
  if (typeof storedBalance !== "number") {
    if (entries.length) {
      errors.push(storedBalance === undefined ? "нет balance при непустой истории" : `balance «${storedBalance}» не число при непустой истории`);
    }
    storedBalance = 0;
  }
  if (!Number.isInteger(storedBalance)) errors.push(`balance ${storedBalance} не целое число`);

  const mismatches = {};
  if (storedBalance !== computedBalance) mismatches.balance = { stored: storedBalance, computed: computedBalance };
  let missingBadges = [];
  if (bp) {
    const computedXp = bp.completions.reduce((s, c) => s + c.xp, 0);
    if (bp.storedXp !== computedXp) mismatches.xp = { stored: bp.storedXp, computed: computedXp };
    const claimedBadges = new Set(bp.claims.map(c => c.badgeNumber));
    missingBadges = bp.storedBadges.filter(b => !claimedBadges.has(b));
    if (missingBadges.length) mismatches.badges = { missing: missingBadges };
  }
  // Корректировка должна влезть в колонки integer — иначе --apply упал бы посреди записи
  if (mismatches.balance && Math.abs(storedBalance - computedBalance) > MAX_AMOUNT) {
    errors.push(`расхождение баланса ${storedBalance - computedBalance} вне допустимого диапазона`);
  }
  if (mismatches.xp && Math.abs(mismatches.xp.stored - mismatches.xp.computed) > INT4_MAX) {
    errors.push(`расхождение XP ${mismatches.xp.stored - mismatches.xp.computed} вне допустимого диапазона`);
  }
  const hasMismatch = Object.keys(mismatches).length > 0;

  // --reconcile: явные корректирующие записи, чтобы после переезда пользователь видел те же числа.
  // При ошибках разбора не корректируем: разница может быть следствием ошибки, а не старого расхождения.
  const corrections = [];
  if (reconcile && bp && !errors.length) {
    if (mismatches.balance) {
      const date = todayISO(now);
      const maxKey = entries.filter(e => e.date === date).reduce((m, e) => Math.max(m, e.sortKey), 0);
      entries.push({
        date, sortKey: Math.max(now.getTime(), maxKey + 1), kind: "admin_bonus", subject: CORRECTION_SUBJECT,
        grade: null, gradeText: "—", reward: storedBalance - computedBalance,
        bonusDesc: `Сверка с Firestore: баланс ${storedBalance}, сумма истории ${computedBalance}`
      });
      corrections.push(`запись «${CORRECTION_SUBJECT}» на ${storedBalance - computedBalance} ₽`);
    }
    if (mismatches.xp) {
      bp.completions.push({ taskRef: null, xp: mismatches.xp.stored - mismatches.xp.computed });
      corrections.push(`отметка XP без задания на ${mismatches.xp.stored - mismatches.xp.computed}`);
    }
    for (const b of missingBadges) {
      bp.claims.push({ rewardRef: null, badgeNumber: b });
      corrections.push(`отметка бейджа ${b} без награды`);
    }
  }

  // Ожидаемое состояние — в том порядке, в каком его отдаёт API: история новыми сверху,
  // задания по порядку добавления, награды по уровню (при равном — по порядку добавления)
  const expected = bp && {
    balance: storedBalance,
    xp: bp.storedXp,
    level: levelFromXP(bp.storedXp, bp.season),
    badges: bp.storedBadges,
    season: [bp.season.number, bp.season.name, bp.season.maxLevel, bp.season.xpPerLevel],
    entries: [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.sortKey - a.sortKey).map(entryFingerprint),
    tasks: bp.tasks.map(taskFingerprint),
    rewards: [...bp.rewards].sort((a, b) => a.level - b.level).map(rewardFingerprint),
    // Отметки — по содержимому задания или награды, на которые ссылаются
    completedTasks: bp.completions.filter(c => c.taskRef !== null).map(c => taskFingerprint(bp.tasks[c.taskRef])).sort(),
    claimedRewards: bp.claims.filter(c => c.rewardRef !== null).map(c => rewardFingerprint(bp.rewards[c.rewardRef])).sort()
  };

  return {
    uid,
    email: typeof data?.email === "string" ? data.email : null,
    entries,
    battlePass: bp,
    mismatches,
    corrections,
    errors,
    warnings,
    blocked: errors.length > 0 || (hasMismatch && !reconcile),
    expected
  };
}

const entryFingerprint = (e) =>
  JSON.stringify([e.date, e.kind, e.subject, e.grade ?? e.gradeText, e.reward, e.bonusDesc]);
const taskFingerprint = (x) => JSON.stringify([x.name, x.type, x.target ?? null, x.xp]);
const rewardFingerprint = (x) => JSON.stringify([x.level, x.text, x.type, x.amount ?? null, x.badgeNumber ?? null]);

// ---- Весь бэкап
export function planDump(dump, options) {
  const users = dump?.collections?.users;
  if (!Array.isArray(users)) throw new Error("В файле нет collections.users — это не бэкап scripts/export-firestore.mjs?");
  const notes = Object.keys(dump.collections).filter(c => c !== "users").map(c => `коллекция ${c} не переносится`);
  const plans = users.map(doc => planUser(doc, options));
  // Два документа с одним uid перезаписали бы друг друга — блокируем оба
  const seen = new Map();
  for (const p of plans) seen.set(p.uid, (seen.get(p.uid) ?? 0) + 1);
  for (const p of plans) {
    if (seen.get(p.uid) > 1) {
      p.errors.push(`uid встречается в бэкапе ${seen.get(p.uid)} раза`);
      p.blocked = true;
    }
  }
  return { notes, users: plans };
}

// ---- Запись одного пользователя: замена всех его данных в Neon
export async function applyUser(db, plan) {
  if (plan.blocked) throw new Error(`${plan.uid}: план заблокирован — сначала устраните ошибки и расхождения`);
  const uid = plan.uid;
  const bp = plan.battlePass;
  return db.transaction(async tx => {
    const user = tx.insert(t.users).values({ id: uid, email: plan.email });
    await (plan.email ? user.onConflictDoUpdate({ target: t.users.id, set: { email: plan.email } }) : user.onConflictDoNothing());
    await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.id, uid)).for("update");

    // Сезоны удаляются каскадом вместе с заданиями, наградами и отметками
    await tx.delete(t.entries).where(eq(t.entries.userId, uid));
    await tx.delete(t.bpSeasons).where(eq(t.bpSeasons.userId, uid));

    for (let i = 0; i < plan.entries.length; i += INSERT_CHUNK) {
      await tx.insert(t.entries).values(plan.entries.slice(i, i + INSERT_CHUNK).map(e => ({ userId: uid, ...e })));
    }

    const [season] = await tx.insert(t.bpSeasons).values({ userId: uid, ...bp.season, isActive: true }).returning();
    const taskIds = [], rewardIds = [];
    for (const task of bp.tasks) {
      const [row] = await tx.insert(t.bpTasks).values({ seasonId: season.id, ...task }).returning({ id: t.bpTasks.id });
      taskIds.push(row.id);
    }
    for (const reward of bp.rewards) {
      const [row] = await tx.insert(t.bpRewards).values({ seasonId: season.id, ...reward }).returning({ id: t.bpRewards.id });
      rewardIds.push(row.id);
    }
    for (const c of bp.completions) {
      await tx.insert(t.bpTaskCompletions).values({
        userId: uid, seasonId: season.id, taskId: c.taskRef === null ? null : taskIds[c.taskRef], xp: c.xp
      });
    }
    for (const c of bp.claims) {
      await tx.insert(t.bpRewardClaims).values({
        userId: uid, seasonId: season.id, rewardId: c.rewardRef === null ? null : rewardIds[c.rewardRef], badgeNumber: c.badgeNumber
      });
    }

    const state = await buildState(tx, uid);
    const diff = compareState(state, plan.expected);
    if (diff.length) throw new Error(`${uid}: после записи состояние не совпало с Firestore — откат: ${diff.join("; ")}`);
    return state;
  });
}

// Состояние API против ожидаемого из Firestore; пустой массив — совпало
export function compareState(state, expected) {
  const bp = state.battlePass;
  const diff = [];
  const check = (name, actual, wanted) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) diff.push(`${name}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(wanted)}`);
  };
  check("баланс", state.balance, expected.balance);
  check("XP", bp.xp, expected.xp);
  check("уровень", bp.level, expected.level);
  check("бейджи", bp.badges, expected.badges);
  check("сезон", [bp.season, bp.seasonName, bp.maxLevel, bp.xpPerLevel], expected.season);
  check("задания", bp.tasks.map(taskFingerprint), expected.tasks);
  check("награды", bp.rewards.map(rewardFingerprint), expected.rewards);
  const byId = (list, fingerprint) => (id) => fingerprint(list.find(x => x.id === id) ?? {});
  check("выполнено заданий", bp.completedTasks.map(byId(bp.tasks, taskFingerprint)).sort(), expected.completedTasks);
  check("получено наград", bp.claimedRewards.map(byId(bp.rewards, rewardFingerprint)).sort(), expected.claimedRewards);
  const actualEntries = state.history.map(h => {
    const numeric = typeof h.grade === "number";
    return entryFingerprint({ ...h, bonusDesc: h.bonus, date: ruDateToISO(h.date), grade: numeric ? h.grade : null, gradeText: numeric ? null : h.grade });
  });
  // Порядок важен: API должно отдать историю в порядке, рассчитанном при разборе (см. planEntries)
  if (actualEntries.length !== expected.entries.length) {
    diff.push(`записей: ${actualEntries.length} ≠ ${expected.entries.length}`);
  } else {
    const i = actualEntries.findIndex((e, k) => e !== expected.entries[k]);
    if (i >= 0) diff.push(`запись №${i + 1} новыми сверху: ${actualEntries[i]} ≠ ${expected.entries[i]}`);
  }
  return diff;
}

// ---- Отчёт для человека
export function formatReport({ notes, users }, { reconcile = false } = {}) {
  const lines = [];
  for (const n of notes) lines.push(`ℹ️  ${n}`);
  for (const p of users) {
    const bp = p.battlePass;
    const status = p.errors.length ? "❌" : p.blocked ? "⚠️ " : "✅";
    lines.push("", `${status} ${p.uid}${p.email ? ` (${p.email})` : ""}`);
    lines.push(`   записей: ${p.entries.length}; баланс в Firestore: ${p.expected?.balance ?? "—"}`);
    if (bp) {
      lines.push(`   боевой пропуск: сезон ${bp.season.number} «${bp.season.name}», XP ${bp.storedXp}, уровень ${p.expected.level}, ` +
        `заданий ${bp.tasks.length} (выполнено ${p.expected.completedTasks.length}), наград ${bp.rewards.length} ` +
        `(получено ${p.expected.claimedRewards.length}), бейджи [${bp.storedBadges.join(", ")}]`);
    }
    const m = p.mismatches;
    if (m.balance) lines.push(`   расхождение баланса: сохранён ${m.balance.stored}, сумма истории ${m.balance.computed} (разница ${m.balance.stored - m.balance.computed})`);
    if (m.xp) lines.push(`   расхождение XP: сохранено ${m.xp.stored}, сумма выполненных заданий ${m.xp.computed} (разница ${m.xp.stored - m.xp.computed})`);
    if (m.badges) lines.push(`   бейджи без отметки о награде: ${m.badges.missing.join(", ")}`);
    for (const c of p.corrections) lines.push(`   + корректировка: ${c}`);
    for (const e of p.errors) lines.push(`   ошибка: ${e}`);
    for (const w of p.warnings) lines.push(`   внимание: ${w}`);
  }
  const blocked = users.filter(p => p.blocked);
  lines.push("", `Пользователей: ${users.length}, готовы к записи: ${users.length - blocked.length}, заблокированы: ${blocked.length}`);
  if (blocked.some(p => !p.errors.length) && !reconcile) {
    lines.push("Расхождения можно закрыть корректирующими записями: добавьте --reconcile.");
  }
  return lines.join("\n");
}
