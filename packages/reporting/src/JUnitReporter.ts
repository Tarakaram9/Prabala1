// ─────────────────────────────────────────────────────────────────────────────
// Prabala Reporting – JUnit XML Reporter (CI/CD compatible)
// Produces junit-results.xml readable by GitHub Actions, Azure DevOps,
// Jenkins (JUnit plugin) and GitLab CI.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { SuiteResult, TestResult } from '@prabala/core';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class JUnitReporter {
  private outputDir: string;

  constructor(outputDir: string = 'artifacts') {
    this.outputDir = outputDir;
    fs.mkdirSync(outputDir, { recursive: true });
  }

  generate(suite: SuiteResult): string {
    const xml = this.buildXml(suite);
    const reportPath = path.join(this.outputDir, 'junit-results.xml');
    fs.writeFileSync(reportPath, xml, 'utf-8');
    return reportPath;
  }

  private buildXml(suite: SuiteResult): string {
    const total   = suite.passed + suite.failed + suite.skipped;
    const durationSec = (suite.totalDurationMs / 1000).toFixed(3);

    const testCasesXml = suite.tests
      .map((t) => this.buildTestCase(t))
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Prabala" tests="${total}" failures="${suite.failed}" skipped="${suite.skipped}" time="${durationSec}" timestamp="${suite.startTime}">
  <testsuite name="${escapeXml(suite.suite)}" tests="${total}" failures="${suite.failed}" skipped="${suite.skipped}" time="${durationSec}" timestamp="${suite.startTime}">
${testCasesXml}
  </testsuite>
</testsuites>`;
  }

  private buildTestCase(t: TestResult): string {
    const durationSec = (t.durationMs / 1000).toFixed(3);
    const name = escapeXml(t.testCase);

    if (t.status === 'skipped') {
      return `    <testcase name="${name}" classname="prabala" time="${durationSec}"><skipped /></testcase>`;
    }

    if (t.status === 'failed') {
      const failedStep = t.steps.find((s) => s.status === 'failed');
      const message = escapeXml(failedStep?.error ?? 'Test failed');
      return `    <testcase name="${name}" classname="prabala" time="${durationSec}">
      <failure message="${message}" type="AssertionError">${message}</failure>
    </testcase>`;
    }

    return `    <testcase name="${name}" classname="prabala" time="${durationSec}" />`;
  }
}
