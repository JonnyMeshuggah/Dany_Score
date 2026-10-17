// PostToolUse: lint изменённого JS-файла. Ошибки возвращаются агенту (exit 2), чтобы цикл проверки
// замыкался сразу, а не только на npm run check.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { tool_input: input = {}, tool_response: response = {} } = JSON.parse(raw);
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = response.filePath || input.file_path;

if (!file || !/\.(m|c)?jsx?$/.test(file)) process.exit(0);
const rel = path.relative(projectDir, path.resolve(projectDir, file));
if (rel.startsWith("..") || rel.startsWith("node_modules")) process.exit(0);

const eslint = path.join(projectDir, "node_modules", ".bin", "eslint");
if (!fs.existsSync(eslint)) {
  console.error("check-file: eslint не установлен — выполни npm install, иначе файл не проверен.");
  process.exit(2);
}

try {
  execFileSync(eslint, ["--no-warn-ignored", rel], { cwd: projectDir, stdio: "pipe" });
} catch (err) {
  console.error(`ESLint нашёл ошибки в ${rel}:\n${err.stdout?.toString() || err.message}`);
  process.exit(2);
}
