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
- [x] Получить сервисный аккаунт Firebase и снять бэкап (2026-10-18)
- [ ] Проверить текущие Firestore rules
- [x] Подключить Neon через Vercel Marketplace (2026-10-18; одна база на Preview и Production,
      ветку БД для Preview не выделяли — Production-фронт до этапа 6 её не использует)

### 1. Минимальный хотфикс текущей версии
- [x] Убрать лишние записи в Firestore на каждый snapshot (квота, устаревший `isSaving`)
- [x] Импорт CSV: `grade` → число, проставлять `id`, пропускать строки без даты (суммы — как в файле)
- [x] Убрать двойное подключение `app.js` (оставлен статический тег: babel-standalone
      транспилирует только скрипты, которые есть на `DOMContentLoaded`). На этапе 2 babel заменён Vite.

### 2. Инфраструктура и ядро логики
- [x] Vite + React, `vercel.json`, ESLint (React из npm, статика в `public/`, выдача из `dist/`)
- [x] `src/domain/rewards.js` — одно правило бонусов `rewardFor()` для добавления и пересчёта; `dates.js`
- [x] `src/domain/battlePass.js` — проверка заданий, расчёт уровня; `grades.js` — `applyGrade()`
- [x] Тесты (Vitest) по правилам FAQ, для боевого пропуска — на текущее поведение
- [x] Исправлено (тест → фикс): разные бонусы при добавлении и пересчёте, потеря XP при нескольких
      заданиях, `average_score` без новой оценки, дата по умолчанию в UTC
- Осталось на этап 5: устаревшие значения в `addGrade`, `claimReward`, `cashOut`, `applyAdminBonus`
  (`setBalance(balance + …)` из замыкания)

### 3. База и API
- [x] Drizzle-схема (`server/db/schema.mjs`) и миграции (`drizzle/`, `npm run db:migrate`)
- [x] Проверка ID-токена Firebase (`jose`, ключи Google) и админ-токена по PIN с rate-limit в БД
- [x] Эндпоинты — одна функция `api/router.mjs` (rewrite `/api/*` в `vercel.json`, кроме `/api/env`);
      мутации в транзакции с блокировкой строки пользователя, правила — из `src/domain/*`
- [x] Интеграционные тесты на PGlite (Postgres в памяти, те же миграции), без сети
- [x] Подключить Neon к Preview, `npm run db:migrate`, задать `ADMIN_PIN_HASH`/`ADMIN_TOKEN_SECRET`
      (`npm run admin:hash-pin`), проверить на Preview (2026-10-18; админ-переменные — только Preview)
- Отличия от Firestore-версии: XP и бейдж копируются в отметку выполнения/получения — удаление
  задания или награды их не отнимает (как раньше); «сегодня» для выводов и бонусов — по Москве

### 4. Миграция данных Firestore → Neon
- [x] `server/migration/firestore.mjs` + `npm run db:import-firestore -- <бэкап.json>`: вход — JSON
      из `npm run backup:firestore`, к Firestore не обращается. Без `--apply` только сверка, без записи
- [x] Нормализация: даты `ДД.ММ.ГГГГ` (и `Д.М.ГГГГ`) → `date`, `grade` → число (иначе `grade_text`),
      `kind` по префиксу (💸 вывод, 🎁 бонус, 🏆 награда BP); порядок внутри дня — `compareNewestFirst`
      (по нему считаются бонусы дня): записи без `id` (выводы) — внизу своего дня. Firestore-версия
      показывала их сверху, пока следующая оценка не пересортирует историю — суммы не меняются;
      `battlePass` → сезон, задания, награды, отметки
- [x] Отчёт сверки: сумма `reward` vs `balance`, XP выполненных заданий vs `xp`, бейджи без отметки.
      Расхождение блокирует запись; `--reconcile` закрывает его явной записью «🎁 Корректировка при
      переезде» / отметкой XP или бейджа без задания — пользователь видит те же числа, что в Firestore
- [x] Идемпотентность: данные пользователя из бэкапа заменяются целиком в одной транзакции; после
      записи состояние читается тем же `buildState`, что и `GET /api/state`, и сверяется с Firestore —
      при расхождении откат
- [x] Снять бэкап, прогнать сверку, записать в Neon и проверить на Preview (2026-10-18): 15 пользователей,
      расхождений нет, `--reconcile` не понадобился; `GET /api/state` на Preview совпал с Firestore.
      Перед этапом 6 — повторить бэкап и перенос (идемпотентно), данные в Firestore продолжают меняться
- Осторожно: `--apply` заменяет данные пользователей из бэкапа в той базе, куда указывает
  `DATABASE_URL`, без подтверждения — сверьте хост в выводе. Каждый пользователь — своя транзакция:
  при сбое на середине записанные остаются, повторный запуск перезапишет всех заново.
  Отсутствующий `balance` при непустой истории — ошибка, `--reconcile` её не закрывает

### 5. Фронт на API
- [x] Переключатель `DATA_BACKEND` в `/api/env`: `api` — новое приложение (`src/app/`), иначе — прежнее
      на Firestore (`src/App.jsx` не менялся). Выбор делает `src/main.js` при старте
- [x] `src/app/`: компоненты (`components/cards.jsx`, `components/AdminPanel.jsx`), клиент `api.js`,
      `GET /api/state` при входе, свежее состояние из ответа каждой мутации; один запрос за раз
      (двойной клик не проводит операцию дважды)
- [x] Диалоги и уведомления (`dialogs.jsx`) вместо `alert`/`confirm`/`prompt`; подтверждение на вывод,
      удаление записи, бонус, импорт и сброс сезона; ошибки Firebase Auth — по-русски
- [x] Админка — PIN через `POST /api/admin/unlock` (токен 30 минут в памяти вкладки) вместо кода в клиенте;
      изменения боевого пропуска сохраняются сразу, кнопки «Сохранить» нет. Импорт CSV — только с PIN
- [x] Тесты: клиент API (`tests/app/api.test.mjs`), экраны на jsdom (`tests/app/App.test.jsx`), `/api/env`
- [x] Функции, появившиеся в Firestore-версии после этапа 5: «Пятик» (оба фронта), запуск сезона
      «Пробуждение Силы знаний» — `POST /api/admin/season/launch` одной транзакцией (прежний сезон в архив).
      Схема не менялась; откат — откат кода, созданные сезоны (новый активный и архивный) останутся в БД
- [ ] `DATA_BACKEND=api` в Vercel для Preview и проверка экранов на Preview (человек)

### 6. Переключение
1. Preview-деплой + миграция копии данных, сверка балансов
2. Read-only в старой версии → финальная миграция (`npm run db:import-firestore`) → `DATA_BACKEND=api`
   и `ADMIN_PIN_HASH`/`ADMIN_TOKEN_SECRET` для Production → Redeploy. Откат — убрать `DATA_BACKEND`
   и Redeploy; данные, внесённые после переключения, останутся только в Neon
3. После переключения удалить `src/App.jsx` и Firestore-скрипты из `index.html`
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
