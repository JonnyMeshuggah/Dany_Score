// PreToolUse-гард: читает вызов инструмента из stdin и печатает решение. Правила — в guard-rules.mjs.
// Любая ошибка → exit 2 (fail closed); в settings.json дополнительно onFailure: block.
import { decide } from "./guard-rules.mjs";

try {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const payload = JSON.parse(raw);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const result = decide(payload, projectDir);
  if (result) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason
      }
    }));
  }
} catch (err) {
  console.error(`guard.mjs: ${err.message}`);
  process.exit(2);
}
