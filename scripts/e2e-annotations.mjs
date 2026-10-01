/**
 * Emit GitHub Actions error annotations from Playwright's JSON report.
 *
 * Job logs and uploaded artifacts are not retrievable from every environment,
 * but check-run annotations ARE readable through the Actions API. This step
 * (run with `if: always()` after the e2e suite) records, for each failed test:
 * the file, the test title, and the first lines of the assertion error — so a
 * red run can be diagnosed without log access.
 *
 * Caps at 10 annotations (workflow-command per-step limit for errors).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const reportPath = join(process.cwd(), 'test-results', 'results.json');
const MAX = 10;

/** GitHub workflow-command escaping for the message payload. */
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

function walk(node, trail, out) {
  if (!node) return;
  const here = node.title ? [...trail, node.title] : trail;
  for (const spec of node.specs ?? []) {
    for (const t of spec.tests ?? []) {
      if (t.status === 'expected' || t.status === 'skipped') continue;
      const results = t.results ?? [];
      const last = results[results.length - 1];
      const message = last?.error?.message ?? last?.error ?? t.status;
      out.push({
        title: [...here, spec.title].join(' › '),
        status: t.status,
        message: typeof message === 'string' ? message : JSON.stringify(message),
      });
    }
  }
  for (const child of node.suites ?? []) walk(child, here, out);
}

if (!existsSync(reportPath)) {
  console.log(
    `::error title=E2E report missing::Playwright produced no results.json at ${reportPath} — the runner likely crashed before writing the report.`,
  );
  process.exit(0);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const failures = [];
for (const suite of report.suites ?? []) walk(suite, [], failures);

if (failures.length === 0) {
  console.log(
    `::notice title=E2E report::No failed tests in results.json (stats: ${JSON.stringify(report.stats ?? {})}).`,
  );
  process.exit(0);
}

for (const f of failures.slice(0, MAX)) {
  const firstLines = f.message.split('\n').slice(0, 8).join(' | ');
  const detail = `${f.status}: ${firstLines}`.replace(/\s+/g, ' ').slice(0, 700);
  console.log(`::error title=E2E failure::${esc(f.title)} — ${esc(detail)}`);
}
if (failures.length > MAX) {
  console.log(
    `::warning title=E2E failures truncated::${failures.length - MAX} additional failing test(s) not annotated (limit ${MAX}).`,
  );
}
