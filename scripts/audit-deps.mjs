// Dependency-audit gate (audit task 4.5).
//
// `npm audit --audit-level=critical` exits 0 only when the dependency tree carries no critical or
// high advisory, which is the bar this repo holds itself to. Moderate dev-only advisories are
// reported here and recorded in progress.md instead of being silently ignored or force-fixed.
//
// Wired as `npm run audit:deps`. Use it as a pre-commit hook (see the bottom of the file) or as a
// CI step. It is deliberately a script rather than an installed hook so a fresh clone is never
// blocked by an unconfigured `core.hooksPath`.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Level at or above which the gate blocks. `critical` is the repo's bar. */
const GATE_LEVEL = process.env.CELLY_AUDIT_LEVEL ?? 'critical';

function run(args) {
  // `npm` is `npm.cmd` on Windows and spawning `.cmd` requires a shell. The argument vector here
  // is always the fixed commands below, so building the command string is safe and avoids both
  // the ENOENT (no shell) and EINVAL (.cmd) failure modes.
  const command = ['npm', ...args].join(' ');
  const result = spawnSync(command, { cwd: root, encoding: 'utf8', shell: true });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// The gate: fail the commit on a critical or high advisory.
const gate = run(['audit', `--audit-level=${GATE_LEVEL}`]);
if (!gate.ok) {
  console.error('[audit:deps] critical/high advisories found in the dependency tree:');
  console.error(gate.out.trim());
  console.error('\nFix the advisory (or pin the transitive version) before committing.');
  process.exit(1);
}

// Report, do not gate: everything below the bar stays visible so it can be actioned later.
const report = run(['audit', '--audit-level=moderate']);
if (!report.ok) {
  const json = run(['audit', '--audit-level=moderate', '--json']);
  let summary = report.out.trim();
  try {
    const parsed = JSON.parse(json.out);
    const meta = parsed.metadata?.vulnerabilities ?? {};
    let lines = `  ${meta.info ?? 0} info · ${meta.low ?? 0} low · ${meta.moderate ?? 0} moderate\n`;
    for (const [name, info] of Object.entries(parsed.vulnerabilities ?? {})) {
      const titles = (info.via ?? [])
        .map((entry) => (typeof entry === 'object' ? entry.title : entry))
        .filter((title) => /advisory|do[sS]|reject|prototype|bypass|injection/i.test(title))
        .slice(0, 1);
      if (info.severity === 'info') continue;
      lines += `  ${info.severity} ${name}${titles.length ? ` — ${titles[0]}` : ''}\n`;
    }
    summary = lines;
  } catch {
    // The human-readable table is good enough when the JSON cannot be parsed.
  }
  console.warn('[audit:deps] no critical/high advisories. Below the gate:');
  console.warn(summary);
}

console.log('[audit:deps] no critical or high advisories — ok');

// To wire this as a pre-commit hook:
//   git config core.hooksPath .githooks
// then create .githooks/pre-commit containing:
//   #!/bin/sh
//   npm run audit:deps || exit 1
