import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ARENA 3D Group 29 — CI and deployment gates.
 *
 * ## Why this is code and not a checklist
 *
 * A CI workflow is a document. Nothing stops a future change from deleting the PostgreSQL job, dropping the
 * container build, or — the failure this group actually found — leaving a whole application out of the pipeline.
 * All three have happened in real repositories, and none of them announce themselves: the pull request goes
 * green, and the gap is discovered at release.
 *
 * So the invariants are asserted by tests that read the workflow file. A gate that no longer exists is a failing
 * test, not an unremarked absence.
 *
 * ## What this does NOT claim
 *
 * - It does not claim the workflow **ran**. Nothing in this sandbox can execute GitHub Actions.
 * - It does not claim the container image **builds**. No container runtime is available here, so the build job is
 *   declared and its presence is asserted; its success is a GitHub-side fact, not a local one.
 * - It does not claim a **deployment** happened. No deploy job, no environment protection, no registry push is
 *   configured — see the gaps section of the runbook.
 */

export interface WorkflowJob {
  readonly name: string;
  readonly description: string;
  /** Substrings that must appear somewhere in the job's definition for it to be intact. */
  readonly requiredFragments: string[];
}

export interface WorkflowRequirement {
  readonly path: string;
  readonly jobs: WorkflowJob[];
  /** Commands that must appear in `package.json` for the workflow steps to be able to run. */
  readonly requiredScripts: string[];
}

/**
 * Every gate this repository claims to have.
 *
 * Deliberately explicit rather than derived: if someone renames a job, this list must be updated, which is a
 * visible change in review rather than a silent weakening.
 */
export const REQUIRED_CI: WorkflowRequirement = {
  path: '.github/workflows/ci.yml',
  jobs: [
    {
      name: 'backend',
      description: 'lint, format, build and the unit suite with outbound network blocked',
      requiredFragments: ['npm run lint', 'npm run format:check', 'npm run build', 'npm test'],
    },
    {
      name: 'backend-postgres',
      description: 'the real-PostgreSQL integration suite against a service container',
      requiredFragments: [
        'postgres:16-alpine',
        'PG_TEST_CONFIRM_DISPOSABLE_CLUSTER',
        'npm run test:pg',
      ],
    },
    {
      name: 'backend-container-build',
      description: 'the production image builds',
      requiredFragments: ['docker/build-push-action', 'Dockerfile'],
    },
    {
      name: 'admin-web',
      description: 'admin web types, tests and build',
      requiredFragments: ['npm run ts:check', 'npm test', 'npm run build'],
    },
    {
      name: 'agent-mobile',
      description: 'agent mobile types and tests',
      requiredFragments: ['npm run ts:check', 'npm test'],
    },
    {
      name: 'customer-mobile',
      description: 'customer mobile types and tests',
      requiredFragments: ['npm run ts:check', 'npm test'],
    },
  ],
  requiredScripts: ['lint', 'lint:src', 'lint:test', 'format:check', 'build', 'test', 'test:pg'],
};

export interface GateCheck {
  readonly gate: string;
  readonly present: boolean;
  readonly detail: string;
}

export interface CiGateReport {
  readonly workflowPath: string;
  readonly checks: GateCheck[];
  readonly missing: string[];
  readonly verdict: 'PASS' | 'ERROR';
}

/** A deliberately small YAML reader.
 *
 * The workflow is a fixed, hand-maintained file. Pulling in a YAML parser to read it would add a dependency to
 * assert on a file whose shape is already known; instead the job blocks are located textually, which is enough
 * for the question "does job X contain fragment Y" and fails loudly if the file is restructured.
 */
export function evaluateCiGates(workflowText: string, packageJsonText: string): CiGateReport {
  const checks: GateCheck[] = [];
  const missing: string[] = [];

  const scripts = parseScriptNames(packageJsonText);

  for (const job of REQUIRED_CI.jobs) {
    const block = extractJobBlock(workflowText, job.name);
    if (!block) {
      checks.push({
        gate: `job:${job.name}`,
        present: false,
        detail: `job "${job.name}" (${job.description}) is not defined in the workflow`,
      });
      missing.push(`job:${job.name}`);
      continue;
    }
    const absent = job.requiredFragments.filter((fragment) => !block.includes(fragment));
    if (absent.length > 0) {
      checks.push({
        gate: `job:${job.name}`,
        present: false,
        detail: `job "${job.name}" lost required step(s): ${absent.join(', ')}`,
      });
      missing.push(`job:${job.name}`);
      continue;
    }
    checks.push({ gate: `job:${job.name}`, present: true, detail: job.description });
  }

  for (const script of REQUIRED_CI.requiredScripts) {
    const present = scripts.has(script);
    checks.push({
      gate: `script:${script}`,
      present,
      detail: present
        ? `npm run ${script} is defined`
        : `npm script "${script}" is missing, so a workflow step that runs it would fail`,
    });
    if (!present) missing.push(`script:${script}`);
  }

  return {
    workflowPath: REQUIRED_CI.path,
    checks,
    missing,
    verdict: missing.length === 0 ? 'PASS' : 'ERROR',
  };
}

/** Reads the repo's own workflow and package.json and evaluates them. */
export function evaluateRepositoryCiGates(repoRoot: string): CiGateReport {
  const workflowText = readFileSync(join(repoRoot, REQUIRED_CI.path), 'utf8');
  const packageJsonText = readFileSync(join(repoRoot, 'package.json'), 'utf8');
  return evaluateCiGates(workflowText, packageJsonText);
}

/**
 * Extracts a top-level job block by indentation.
 *
 * Jobs are keys under the top-level `jobs:` map, so they sit at two spaces (`  job-name:`). The block runs until
 * the next two-space key or until a line dedents to column 0. Anything else — including the nested `steps:` list
 * at four spaces — is part of the block.
 *
 * The indentation is read from the file rather than hard-coded, so a reformatted workflow does not silently make
 * every gate look absent (which would be a false failure, and a confusing one).
 */
export function extractJobBlock(workflowText: string, jobName: string): string | null {
  const lines = workflowText.split('\n');
  const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Find `jobs:` at column 0, then the first key indented beneath it — that establishes the job indentation.
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex === -1) return null;
  let jobIndent = 2;
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) continue;
    const match = /^( +)[A-Za-z0-9_-]+:\s*$/.exec(line);
    if (match) {
      jobIndent = (match[1] ?? '  ').length;
      break;
    }
  }

  const header = new RegExp(`^ {${jobIndent}}${escaped}:\\s*$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) return null;

  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (new RegExp(`^ {${jobIndent}}[A-Za-z0-9_-]+:\\s*$`).test(line)) break;
    if (/^[A-Za-z]/.test(line)) break;
    collected.push(line);
  }
  return collected.join('\n');
}

/** Script names from a package.json file's text. */
export function parseScriptNames(packageJsonText: string): Set<string> {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (!parsed || typeof parsed !== 'object') return new Set();
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== 'object') return new Set();
  return new Set(Object.keys(scripts as Record<string, unknown>));
}
