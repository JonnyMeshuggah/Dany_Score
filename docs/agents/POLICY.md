# Политика инструментов, моделей и доступа

Пересматривать раз в квартал и при смене модели, клиента или интеграции. Владелец — tech lead проекта.

## Клиенты и профили разрешений
| Клиент | Конфиг в репозитории | Профили |
|---|---|---|
| Claude Code | `.claude/settings.json`, `.claude/hooks/`, `.claude/agents/`, `.claude/skills/` | По умолчанию — `default` (ask). Plan Mode — для исследования. `bypassPermissions` запрещён (`disableBypassPermissionsMode`) |
| OpenCode | `opencode.json` | `plan` — read-only (edit: deny), `build` — scoped write (edit/bash: ask), `review` — subagent read-only |

Технические контроли Claude Code:
- **permissions** — allow / ask / deny в `.claude/settings.json`;
- **hook `guard.mjs`** (PreToolUse, правила в `guard-rules.mjs`, тесты в `tests/guard.test.mjs`) —
  блокирует секреты, push, деплой, разрушительные команды, разбирая команду по сегментам
  (`npx -y vercel`, `git -C . push`, `git commit -n` тоже ловятся); запись в контроли через shell — ask;
  срабатывает в любом режиме, при сбое хука действие блокируется (`onFailure: block` + exit 2);
- **ограничение гарда:** команды, которые читают секреты, не называя их (`grep -r .`, `find . -exec cat`),
  он не видит — от них защищает только `sandbox.filesystem.denyRead`. Sandbox не отключать;
- **hook `check-file.mjs`** (PostToolUse) — lint изменённого JS-файла, ошибки возвращаются агенту;
- **sandbox** — Bash в песочнице, сеть только к npm/GitHub, чтение `secrets/`, `backups/`, `.env` запрещено.

Пробел: в OpenCode защита секретов держится только на permission-правилах Bash/edit; отдельного
плагина-гарда нет. Рискованные задачи в OpenCode запускать только в изолированной среде.

## Разрешённые модели
| Класс задачи | Модель | Профиль |
|---|---|---|
| Поиск / объяснение | `claude-opus-5-5`, `claude-sonnet-5-5`, GLM — *после утверждения* | read-only |
| Небольшой bugfix, средняя логика | `claude-opus-5-5`, `claude-sonnet-5-5` | scoped write |
| Миграции, данные, auth | `claude-opus-5-5` | scoped write, deny by default, человек подтверждает каждый шаг |
| Review | модель, **отличная** от автора (агент `reviewer` использует `sonnet`) | read-only |

GLM: провайдер, endpoint, допустимые классы данных и model options не утверждены — до утверждения
не использовать на коде с доступом к данным пользователей.

## Данные
- Персональные данные ребёнка (история оценок, баланс, email) не передаются в промты и логи.
- Бэкапы (`backups/`) и ключи (`secrets/`) — только локально, в git не попадают
  (`.gitignore`, `npm run check:secrets`, pre-commit, CI).
- Ключ Firebase для скриптов — сервисный аккаунт с ролью **Cloud Datastore Viewer** (только чтение),
  а не ключ по умолчанию с правами владельца.

## MCP и интеграции
Подключённые к рабочей машине MCP-серверы (GitLab, Postgres, Yandex Tracker и т.п.) к этому проекту
не относятся. Для работы над Dany_Score новые MCP добавлять только после записи сюда:
сервер, владелец, scopes (предпочтительно read-only), зачем нужен.

| Сервер | Scope | Статус |
|---|---|---|
| — | — | Пока не нужны |

## Защита ветки `main` (настраивает владелец репозитория)
Изменения в `main` — только через PR с зелёным CI (`check`), для всех, включая владельца.
Обязательное одобрение не включено: у репозитория один мейнтейнер, а свой PR одобрить нельзя —
human review фиксируется в PR-шаблоне. Когда появится второй участник — поднять до 1.
```
gh auth login
gh api -X PUT repos/JonnyMeshuggah/Dany_Score/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["check"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
gh api repos/JonnyMeshuggah/Dany_Score/branches/main/protection -q '.required_status_checks.contexts'
```
Требуются права администратора репозитория. Без `gh`: Settings → Branches → Add rule для `main` →
Require a pull request, Require status checks (`check`), Do not allow bypassing, без force push.

## Инциденты
Если агент выполнил разрушительное действие или секрет попал в контекст/лог/коммит:
1. Остановить сессию.
2. Секрет — **отозвать сразу** (Firebase Console → Service accounts → удалить ключ; Neon → сбросить
   пароль роли), затем выпустить новый. Удаление из истории git не отменяет утечку.
3. Данные — восстановить из последнего `backups/firestore-*.json` (или Neon branch / PITR после переезда).
4. Записать в этот файл: что случилось, какой контроль не сработал, что добавили.

| Дата | Что случилось | Какой контроль добавлен |
|---|---|---|
| — | — | — |
