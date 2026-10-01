#!/usr/bin/env node
// Claude Code PreToolUse hook for the Bash tool: redirects "dig into a JAR" shell commands
// (javap, unzip/jar on .jar files, ~/.gradle/caches, ~/.m2) to the jvmsrc MCP tools.
// Why: those commands silently pick whichever version is on disk, not the one the build resolves.
// Disable temporarily with JVMSRC_HOOK_DISABLE=1. Wiring: see README "Make your agent use it".
import process from 'node:process';

const RULES = [
  [/(^|[\s;&|(])javap(\s|$)/, 'javap'],
  [/(^|[\s;&|(])(unzip|zipinfo)\b[^|;&]*\.jar\b/, 'unzip on a JAR'],
  [/(^|[\s;&|(])jar\s+-?[a-zA-Z]*[tx]/, 'jar tf/xf'],
  [/\.gradle\/caches|\.gradle\\caches/, 'the Gradle cache'],
  [/\.m2\/repository|\.m2\\repository/, 'the Maven local repository'],
];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  if (process.env.JVMSRC_HOOK_DISABLE === '1') {
    return;
  }
  let command = '';
  try {
    command = String(JSON.parse(raw)?.tool_input?.command ?? '');
  } catch {
    return; // never block on malformed input
  }
  const hit = RULES.find(([re]) => re.test(command));
  if (!hit) {
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Blocked: ${hit[1]} reads whatever version is on disk, not the one this build resolves. ` +
          'Use the jvmsrc MCP tools instead: search_classes (unknown name) → get_class_structure → ' +
          'get_class_source with methodNames; resolve_dependencies for versions.',
      },
    }),
  );
});
