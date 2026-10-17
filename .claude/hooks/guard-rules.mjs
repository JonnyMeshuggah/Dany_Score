// Правила PreToolUse-гарда. Отдельный модуль, чтобы покрыть тестами (tests/guard.test.mjs);
// guard.mjs только читает stdin и печатает решение.
// Слой независим от permissions в settings.json; последняя линия для рекурсивных чтений — sandbox.denyRead.
import path from "node:path";

const DEPLOY_TOOLS = new Set(["vercel", "firebase", "firebase-tools"]);
const WRAPPERS = new Set(["sudo", "env", "time", "nohup", "command", "exec", "xargs"]);
const RUNNERS = { npx: 0, bunx: 0, npm: "exec", pnpm: ["dlx", "exec"], yarn: ["dlx", "exec"] };

const CONTROL_PREFIXES = [".claude/", ".github/", ".githooks/"];
const CONTROL_FILES = ["opencode.json"];

// Упоминание защищённых путей в shell-команде (регистр не важен: файловая система macOS к нему нечувствительна)
const BASH_PROTECTED = [
  /(^|[\s'"=:/])(\.\/)?(secrets|backups)(\/|\s|$|['"*])/i,
  /(^|[\s'"=/])\.env(?!\.example\b)(?=$|[\s'";|&)*?.\w-])/i,
  /(^|\s)\.[\w.-]*[*?]/,                 // dot-глобы: .e*, .* — могут раскрыться в .env
  /service-account[\w.*-]*\.json/i,
];
const CONTROL_MENTION = /(^|[\s'"=/])(\.\/)?(\.(claude|github|githooks)(\/|\s|$|['"])|opencode\.json)/i;
const WRITE_OPS = /(>|\b(sed|perl)\s+(-\w+\s+)*-i|\b(tee|cp|mv|rm|chmod|ln|truncate|install|touch|mkdir)\b|\bgit\s+(checkout|restore|rm|mv)\b)/;

const deny = reason => ({ decision: "deny", reason: `Заблокировано guard.mjs: ${reason}` });
const ask = reason => ({ decision: "ask", reason });

// Кавычки заменяем заглушкой: флаги и слова внутри сообщения коммита не должны влиять на разбор
function stripQuoted(cmd) {
  return cmd.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, " QUOTED ");
}

function segments(cmd) {
  return stripQuoted(cmd).split(/&&|\|\||[;|&\n()`]|\$\(/).map(s => s.trim().split(/\s+/).filter(Boolean)).filter(t => t.length);
}

// Настоящая исполняемая команда сегмента: пропускаем VAR=1, sudo/env, npx -y, npm exec, pnpm dlx и т.п.
function resolveCommand(tokens) {
  let i = 0;
  const skipFlags = () => { while (i < tokens.length && tokens[i].startsWith("-")) i++; };
  for (;;) {
    while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) i++;
    const name = path.posix.basename(tokens[i] || "").replace(/@.*$/, "").toLowerCase();
    if (WRAPPERS.has(name)) { i++; skipFlags(); continue; }
    if (name in RUNNERS) {
      const sub = RUNNERS[name];
      if (sub === 0) { i++; skipFlags(); continue; }
      const subs = Array.isArray(sub) ? sub : [sub];
      if (subs.includes((tokens[i + 1] || "").toLowerCase())) { i += 2; skipFlags(); continue; }
    }
    return { name, args: tokens.slice(i + 1) };
  }
}

// Подкоманда git с учётом глобальных опций: git -C dir -c k=v push → push
function gitSubcommand(args) {
  const globals = [];
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    const opt = args[i];
    globals.push(opt);
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(opt)) globals.push(args[++i] || "");
    i++;
  }
  return { sub: (args[i] || "").toLowerCase(), subArgs: args.slice(i + 1), globals };
}

function shortFlags(args) {
  return args.filter(a => /^-[a-zA-Z]+$/.test(a)).join("");
}

function checkSegment(tokens) {
  const { name, args } = resolveCommand(tokens);

  if (DEPLOY_TOOLS.has(name)) return deny("деплой и доступ к облаку выполняет человек.");

  if (name === "npm" && (args[0] || "").toLowerCase() === "publish") return deny("публикация пакетов запрещена.");

  if (name === "rm") {
    const flags = shortFlags(args);
    const recursive = /r/i.test(flags) || args.includes("--recursive");
    const force = flags.includes("f") || args.includes("--force");
    if (recursive && force) return deny("rm -rf запрещён — удаляй конкретные файлы.");
  }

  if (name === "git") {
    const { sub, subArgs, globals } = gitSubcommand(args);
    if (globals.some(g => /^core\.hookspath=/i.test(g))) return deny("подмена core.hooksPath отключает pre-commit.");
    if (sub === "push") return deny("push выполняет человек после review.");
    if (sub === "commit" && (shortFlags(subArgs).includes("n") || subArgs.includes("--no-verify"))) {
      return deny("обход pre-commit проверок запрещён.");
    }
    if (sub === "reset" && subArgs.includes("--hard")) return deny("git reset --hard уничтожает незакоммиченную работу.");
    if (sub === "clean" && (shortFlags(subArgs).includes("f") || subArgs.includes("--force"))) {
      return deny("git clean -f удаляет неотслеживаемые файлы.");
    }
    if (sub === "config" && subArgs.some(a => /^core\.hookspath$/i.test(a))) return deny("подмена core.hooksPath отключает pre-commit.");
  }
  return null;
}

export function isProtectedPath(rel) {
  const p = rel.split(path.sep).join("/").toLowerCase();
  const base = path.posix.basename(p);
  if (p === "secrets" || p.startsWith("secrets/")) return true;
  if (p === "backups" || p.startsWith("backups/")) return true;
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") return true;
  if (/service-account.*\.json$/.test(base)) return true;
  return false;
}

function isControlPath(rel) {
  const p = rel.split(path.sep).join("/").toLowerCase();
  return CONTROL_FILES.includes(p) || CONTROL_PREFIXES.some(prefix => p.startsWith(prefix));
}

function toRel(projectDir, p) {
  const rel = path.relative(projectDir, path.resolve(projectDir, p));
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
}

export function decide({ tool_name: tool, tool_input: input = {} }, projectDir) {
  if (tool === "Bash") {
    const cmd = String(input.command || "");
    if (/--no-verify\b/.test(stripQuoted(cmd))) return deny("обход pre-commit проверок запрещён.");
    for (const tokens of segments(cmd)) {
      const result = checkSegment(tokens);
      if (result) return result;
    }
    if (BASH_PROTECTED.some(re => re.test(cmd))) {
      return deny("команда затрагивает secrets/, backups/, .env или ключ сервисного аккаунта. " +
        "Такие команды (например, npm run backup:firestore) запускает человек сам.");
    }
    if (CONTROL_MENTION.test(cmd) && WRITE_OPS.test(stripQuoted(cmd))) {
      return ask("Команда меняет технические контроли агентов (.claude/, .github/, .githooks/, opencode.json). Только по явной просьбе человека.");
    }
    return null;
  }

  const candidates = [input.file_path, input.notebook_path, input.path].filter(Boolean);
  if (tool === "Glob" && input.pattern) candidates.push(input.pattern);
  for (const p of candidates) {
    const rel = toRel(projectDir, p);
    if (rel === null) continue;
    if (isProtectedPath(rel)) return deny(`${rel} — секреты или персональные данные, агенту доступ закрыт.`);
    if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool) && isControlPath(rel)) {
      return ask(`${rel} — технический контроль агентов. Изменение только по явной просьбе человека.`);
    }
  }
  return null;
}
