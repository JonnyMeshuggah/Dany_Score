# План: исправления и переезд Firestore → Neon Postgres (Vercel)

Решения: база **Neon Postgres** (Vercel Marketplace), авторизация остаётся **Firebase Auth**,
админка — **PIN, проверяемый на сервере**. Фронт и API — один Vercel-проект.

## Целевая архитектура

```
Браузер (Vite + React)
  ├─ Firebase Auth SDK — только логин, выдаёт ID-токен
  └─ fetch /api/*  с  Authorization: Bearer <idToken>  [+ X-Admin-Token]
        │
Vercel Functions (/api)
  ├─ проверка токена (firebase-admin)
  ├─ бизнес-логика: награды, бонусы, задания BP
  └─ Neon Postgres (Drizzle ORM)
```

Клиент ничего не считает и не пишет в базу напрямую. Баланс, XP, уровень — производные
от записей, хранить их отдельно не нужно.

## Схема БД

| Таблица | Поля |
|---|---|
| `users` | `id` (Firebase uid), `email`, `created_at` |
| `entries` | `id`, `user_id`, `date` (date), `kind` (grade / cashout / admin_bonus / bp_reward), `subject`, `grade`, `reward` (int ₽), `bonus_desc`, `created_at` |
| `bp_seasons` | `id`, `user_id`, `number`, `name`, `max_level`, `xp_per_level`, `is_active` |
| `bp_tasks` | `id`, `season_id`, `name`, `type`, `target`, `xp` |
| `bp_rewards` | `id`, `season_id`, `level`, `text`, `type`, `amount`, `badge_number` |
| `bp_task_completions` | `task_id`, `completed_at` |
| `bp_reward_claims` | `reward_id`, `claimed_at`, `entry_id` |

- баланс = `SUM(entries.reward)`
- XP = сумма `xp` выполненных заданий; уровень = `min(floor(xp / xp_per_level), max_level)`
- бейджи = полученные награды типа `badge`

## API

Пользователь: `GET /api/state`, `POST /api/grades`, `DELETE /api/entries/:id`,
`POST /api/cashout`, `POST /api/bp/rewards/:id/claim`, `GET /api/export.csv`.

Админ: `POST /api/admin/unlock` (PIN → подписанный токен на 30 мин; PIN — хэш в env
`ADMIN_PIN_HASH`, rate-limit). Под токеном: CRUD сезона/заданий/наград,
`POST /api/admin/bonus`, `POST /api/admin/import`, `POST /api/admin/season/reset`.

Каждая мутация — одна транзакция: вставка → пересчёт бонусов дня → проверка заданий BP.

## Этапы

### 0. Подготовка и бэкап
- [x] `scripts/export-firestore.mjs` — дамп Firestore в `backups/*.json`
- [x] `.env.example`, `.gitignore`, `package.json`
- [ ] Получить сервисный аккаунт Firebase и снять бэкап
- [ ] Проверить текущие Firestore rules
- [ ] Подключить Neon через Vercel Marketplace (ветка БД для Preview + Production)

### 1. Минимальный хотфикс текущей версии
- [x] Убрать лишние записи в Firestore на каждый snapshot (квота, устаревший `isSaving`)
- [x] Импорт CSV: `grade` → число, проставлять `id`, пропускать строки без даты (суммы — как в файле)
- [x] Убрать двойное подключение `app.js` (оставлен статический тег: babel-standalone
      транспилирует только скрипты, которые есть на `DOMContentLoaded`)

### 2. Инфраструктура и ядро логики
- Vite + React, `vercel.json`, ESLint
- `src/domain/rewards.js` — единая `computeDayRewards()`; утилиты дат
- `src/domain/battlePass.js` — проверка заданий, расчёт уровня
- Тесты (Vitest) по правилам FAQ

### 3. База и API
- Drizzle-схема и миграции, middleware Firebase-токена и админ-токена, эндпоинты,
  интеграционные тесты на ветке Neon

### 4. Миграция данных Firestore → Neon
- Нормализация: даты `ДД.ММ.ГГГГ` → `date`, `grade` → число, `kind` по префиксу
  (💸 вывод, 🎁 бонус, 🏆 награда BP)
- Отчёт сверки: сумма `reward` vs сохранённый `balance`
- Идемпотентность

### 5. Фронт на API
- Разбить `App` на компоненты, `GET /api/state` + обновление после мутаций,
  нормальные диалоги вместо `alert`/`prompt`, локальная дата вместо UTC

### 6. Переключение
1. Preview-деплой + миграция копии данных, сверка балансов
2. Read-only в старой версии → финальная миграция → Production
3. Firestore держим как резерв 2–4 недели, затем удаляем

## Откат (rollback)

Все этапы — высокий риск (`docs/agents/RISK.md`). Для каждого — как вернуться назад:

| Этап | Как откатить | Кто решает |
|---|---|---|
| 1. Хотфикс | `git revert` коммита хотфикса → редеплой. Данные не меняются по схеме, откат безопасен | Владелец |
| 3–5. API и фронт на Neon | Фронт на API выкатывается в Preview; Production остаётся на Firestore до этапа 6 | Владелец |
| 6. Переключение | Редеплой последнего Production-деплоя на Firestore (Vercel → Deployments → Promote). Firestore не трогаем 2–4 недели, read-only снимается одной правкой | Владелец |
| Данные | Бэкап `backups/firestore-*.json` перед этапами 4 и 6; Neon — отдельная ветка БД на каждый прогон миграции | Владелец |

Критерий отката на этапе 6: расхождение баланса хотя бы у одного пользователя или ошибка сохранения в первые 24 часа.

## Открытые вопросы
1. Исторические суммы: переносить как есть (рекомендуется) или пересчитать по единому правилу?
2. Вывод средств — под PIN?
3. Серия по предмету — только в пределах дня (как сейчас) или через дни?
4. Доступы: сервисный аккаунт Firebase, доступ к Vercel-проекту.
