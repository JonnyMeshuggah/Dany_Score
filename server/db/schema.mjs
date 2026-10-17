// Схема Postgres (docs/MIGRATION_PLAN.md, «Схема БД»). Баланс, XP, уровень и бейджи не хранятся —
// считаются из записей. Миграции: `npm run db:generate` → drizzle/.
import {
  pgTable, pgEnum, text, integer, smallint, bigint, boolean, date, doublePrecision, timestamp, serial,
  index, uniqueIndex
} from "drizzle-orm/pg-core";

export const entryKind = pgEnum("entry_kind", ["grade", "cashout", "admin_bonus", "bp_reward"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Firebase uid
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(), // "ГГГГ-ММ-ДД"
  // Порядок внутри дня (в Firestore это был id-таймштамп записи)
  sortKey: bigint("sort_key", { mode: "number" }).notNull(),
  kind: entryKind("kind").notNull(),
  subject: text("subject").notNull(),
  grade: smallint("grade"), // 2..5; null — нечисловая оценка
  gradeText: text("grade_text"), // «н», «—» и т.п. для нечисловых записей
  reward: integer("reward").notNull(), // ₽, со знаком
  bonusDesc: text("bonus_desc").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, t => [index("entries_user_date_idx").on(t.userId, t.date)]);

export const bpSeasons = pgTable("bp_seasons", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  name: text("name").notNull(),
  maxLevel: integer("max_level").notNull(),
  xpPerLevel: integer("xp_per_level").notNull(),
  isActive: boolean("is_active").notNull().default(true)
}, t => [index("bp_seasons_user_idx").on(t.userId)]);

export const bpTasks = pgTable("bp_tasks", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => bpSeasons.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // streak_fives | total_grades_week | average_score
  target: doublePrecision("target"), // null — значение по умолчанию из src/domain/battlePass.js
  xp: integer("xp").notNull()
});

export const bpRewards = pgTable("bp_rewards", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => bpSeasons.id, { onDelete: "cascade" }),
  level: integer("level").notNull(),
  text: text("text").notNull(),
  type: text("type").notNull(), // money | badge | other
  amount: integer("amount"),
  badgeNumber: smallint("badge_number")
});

// XP и бейдж копируются в отметку: удаление задания или награды не отнимает полученное (как в Firestore)
export const bpTaskCompletions = pgTable("bp_task_completions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  seasonId: integer("season_id").notNull().references(() => bpSeasons.id, { onDelete: "cascade" }),
  taskId: integer("task_id").references(() => bpTasks.id, { onDelete: "set null" }),
  xp: integer("xp").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow()
}, t => [uniqueIndex("bp_task_completions_task_uq").on(t.userId, t.taskId)]);

export const bpRewardClaims = pgTable("bp_reward_claims", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  seasonId: integer("season_id").notNull().references(() => bpSeasons.id, { onDelete: "cascade" }),
  rewardId: integer("reward_id").references(() => bpRewards.id, { onDelete: "set null" }),
  badgeNumber: smallint("badge_number"),
  entryId: integer("entry_id").references(() => entries.id, { onDelete: "set null" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow()
}, t => [uniqueIndex("bp_reward_claims_reward_uq").on(t.userId, t.rewardId)]);

export const adminUnlockAttempts = pgTable("admin_unlock_attempts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  ok: boolean("ok").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow()
}, t => [index("admin_unlock_attempts_user_at_idx").on(t.userId, t.at)]);
