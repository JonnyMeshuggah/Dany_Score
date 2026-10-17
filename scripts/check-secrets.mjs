// Поиск секретов и персональных данных среди файлов, которые могут попасть в git.
// Запускается в npm run check, pre-commit и CI. Ключи Firebase Web (apiKey) публичны и не ищутся.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const CONTENT_RULES = [
  ["приватный ключ", new RegExp("-----BEGIN [A-Z ]*PRIVATE KEY-----")],
  ["JSON сервисного аккаунта", /"type"\s*:\s*"service_account"/],
  ["строка подключения Postgres с паролем", /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
];

export function forbiddenName(file) {
  const base = file.split("/").pop();
  if (/^(secrets|backups)\//.test(file)) return "файл из secrets/ или backups/";
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") return "файл окружения .env";
  if (/service-account.*\.json$/i.test(base)) return "ключ сервисного аккаунта";
  return null;
}

export function scanContent(text) {
  return CONTENT_RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function candidateFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return out.toString().split("\0").filter(Boolean);
}

function main() {
  const problems = [];
  for (const file of candidateFiles()) {
    const byName = forbiddenName(file);
    if (byName) { problems.push(`${file}: ${byName}`); continue; }
    if (file === "package-lock.json" || !fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) continue; // бинарный файл
    for (const name of scanContent(buf.toString("utf8"))) problems.push(`${file}: ${name}`);
  }
  if (problems.length) {
    console.error("❌ Найдены возможные секреты:\n  " + problems.join("\n  "));
    console.error("Убери файл из индекса, добавь в .gitignore; если секрет уже был в коммите — отзови его.");
    process.exit(1);
  }
  console.log("✅ Секретов не найдено");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
