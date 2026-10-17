import { describe, it, expect } from "vitest";
import { decide } from "../.claude/hooks/guard-rules.mjs";

const ROOT = "/project";
const bash = command => decide({ tool_name: "Bash", tool_input: { command } }, ROOT);
const file = (tool, file_path) => decide({ tool_name: tool, tool_input: { file_path } }, ROOT);

describe("guard: Bash — запрещённые действия", () => {
  it.each([
    "git push",
    "git push origin main --force",
    "git -C . push",
    "git -c user.name=x push origin",
    "npm run check && git push",
    "git commit -m x --no-verify",
    "git commit -nm x",
    "git -c core.hooksPath=/dev/null commit -m x",
    "git config core.hooksPath /dev/null",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git clean -d -f",
    "vercel --prod",
    "npx vercel deploy",
    "npx -y vercel deploy",
    "npx --yes vercel@latest",
    "npx firebase-tools deploy",
    "npm exec vercel",
    "pnpm dlx vercel",
    "./node_modules/.bin/vercel",
    "sudo vercel",
    "env X=1 vercel",
    "VERCEL_TOKEN=x vercel deploy",
    "npm run lint && firebase deploy",
    "npm publish",
    "rm -rf node_modules",
    "rm -Rf node_modules",
    "rm -fr /",
    "rm -r --force dir",
  ])("запрещает: %s", cmd => {
    expect(bash(cmd)?.decision).toBe("deny");
  });
});

describe("guard: Bash — секреты", () => {
  it.each([
    "cat secrets/firebase-service-account.json",
    "cat Secrets/key.json",
    "ls backups/",
    "head BACKUPS/firestore.json",
    "FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/key.json npm run backup:firestore",
    "cat .env",
    "cat .ENV",
    "cat .env.local",
    "cat .env*",
    "cat .e*",
    "source .env; echo $DATABASE_URL",
    "cp ~/Downloads/my-service-account-1.json .",
  ])("запрещает: %s", cmd => {
    expect(bash(cmd)?.decision).toBe("deny");
  });
});

describe("guard: Bash — изменение контролей через shell", () => {
  it.each([
    "sed -i '' 's/deny/allow/' .claude/settings.json",
    "echo 'exit 0' > .githooks/pre-commit",
    "cp /tmp/x .github/workflows/ci.yml",
    "git checkout main -- .claude",
  ])("спрашивает: %s", cmd => {
    expect(bash(cmd)?.decision).toBe("ask");
  });
});

describe("guard: Bash — обычная работа", () => {
  it.each([
    "git status",
    "git diff main...HEAD",
    'git commit -m "docs: explain why git push is manual and -n is banned"',
    "git commit -m x",
    "git clean -n",
    "npm run check",
    "npm install -D firebase-admin",
    "grep -n firebase app.js",
    "grep -rn vercel docs",
    "cat .env.example",
    "cat .vercelignore",
    "cat .claude/settings.json",
    "git diff -- .claude",
    "git add .gitignore",
    "rm app.old.js",
    "rm -r build",
    "ls -la",
  ])("пропускает: %s", cmd => {
    expect(bash(cmd)).toBeNull();
  });
});

describe("guard: файловые инструменты", () => {
  it.each([
    ["Read", "/project/secrets/key.json"],
    ["Read", "/project/Secrets/key.json"],
    ["Read", "backups/firestore-x.json"],
    ["Read", "/project/BACKUPS/x.json"],
    ["Read", "/project/.env"],
    ["Read", "/project/.env.production"],
    ["Edit", "/project/secrets/new.json"],
    ["Write", "/project/backups/a.json"],
    ["Read", "/project/firebase-service-account.json"],
  ])("запрещает %s %s", (tool, p) => {
    expect(file(tool, p)?.decision).toBe("deny");
  });

  it("запрещает Grep по защищённой папке", () => {
    expect(decide({ tool_name: "Grep", tool_input: { pattern: "uid", path: "/project/backups" } }, ROOT)?.decision).toBe("deny");
  });

  it.each([
    ["Edit", "/project/.claude/settings.json"],
    ["Write", "/project/.github/workflows/ci.yml"],
    ["Edit", "/project/opencode.json"],
  ])("спрашивает перед изменением контроля %s %s", (tool, p) => {
    expect(file(tool, p)?.decision).toBe("ask");
  });

  it.each([
    ["Read", "/project/app.js"],
    ["Read", "/project/.env.example"],
    ["Read", "/project/.claude/settings.json"],
    ["Edit", "/project/app.js"],
    ["Read", "/elsewhere/secrets/x"],
  ])("пропускает %s %s", (tool, p) => {
    expect(file(tool, p)).toBeNull();
  });
});
