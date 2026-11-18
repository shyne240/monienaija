import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { evaluateRepositoryCiGates } from '../deployment/ci-gate.service';
import { evaluateRepositoryMobileRelease } from '../mobile/mobile-release-readiness.service';
import { FINANCIAL_DEPENDENCY_BLOCKERS } from '../production/production-readiness.service';

/**
 * ARENA 3D Group 34 — the release gate.
 *
 * ## Why this exists
 *
 * Thirty-three groups produced thirty-three verdicts. Each one is defensible on its own, and each
 * one was argued separately in its own document. What none of them does is answer the question a
 * release board actually asks: **may this be deployed?**
 *
 * Answering that by reading the documents is how a mission talks itself into a release. A
 * document cannot be invalidated: the paragraph that says "not certified" is still there after the
 * next commit, and nobody re-reads thirty-three of them the night before a deployment.
 *
 * So this module aggregates. It reads the evidence the other groups produced — the startup gate's
 * dependency list, the CI workflow, the mobile manifests, the recorded browser run — and refuses
 * to answer "ready" while anything that was never verified is still unverified.
 *
 * ## It can say no, and today it does
 *
 * The gate is **not** a constant: a synthetic input with no blockers returns `READY`, and that is
 * asserted. What makes the real repository `NOT_READY` is not one stubborn flag but a list of
 * specific, named things, each with the document that explains it.
 *
 * ## What it does NOT do
 *
 * It does not deploy, promote, or unlock anything. It performs no provider call, executes no
 * financial action, and has no environment override: there is no flag that turns this into a
 * `READY`, because a flag that did would eventually be set. The only way a blocker leaves this
 * report is that the thing it names is actually verified, and the constant below is edited in
 * review.
 */

export type ReleaseVerdict = 'READY' | 'NOT_READY';

export type BlockerCategory =
  | 'financial-dependency'
  | 'operations'
  | 'release-artefact'
  | 'evidence'
  | 'security';

export interface ReleaseBlocker {
  readonly id: string;
  readonly category: BlockerCategory;
  /** One sentence a release board can act on. */
  readonly summary: string;
  /** Where the obligation is recorded, so it can be discharged rather than argued about. */
  readonly evidence: string;
}

export interface ReleaseCondition {
  readonly id: string;
  readonly summary: string;
  readonly evidence: string;
}

export interface GateResult {
  readonly gate: string;
  readonly verdict: 'PASS' | 'WARNING' | 'ERROR';
  readonly detail: string;
}

export interface ReleaseGateReport {
  readonly verdict: ReleaseVerdict;
  /** Everything that makes a release impossible right now. Empty means READY. */
  readonly blockers: ReleaseBlocker[];
  /** Things a human must accept in writing; they do not block, and they are not silently dropped. */
  readonly conditions: ReleaseCondition[];
  /** What each input gate reported, so the verdict can be traced to its sources. */
  readonly gates: GateResult[];
  /** Performed by nobody, and unchangeable by any flag in this repository. */
  readonly notPerformed: string[];
}

/**
 * Obligations that no artefact in this repository can discharge, and no flag may waive.
 *
 * Hand-maintained on purpose, exactly like `REQUIRED_CI`: if one of these is removed, the diff
 * says so and a reviewer sees the release claiming something new. Each `evidence` entry names the
 * document that explains why the obligation exists.
 */
export const OUTSTANDING_REQUIREMENTS: readonly ReleaseBlocker[] = [
  {
    id: 'worker_execution_not_observed_in_deployment',
    category: 'operations',
    summary:
      'the worker role exists, is readiness-gated and is tested, but no deployment has been observed running it: the mechanism is proven, the execution is not',
    evidence: 'docs/integration/WORKER-EXECUTION.md',
  },
  {
    id: 'alert_delivery_not_observed_against_a_real_channel',
    category: 'operations',
    summary:
      'the signed webhook channel exists and delivers to a real socket under test, but no alert has reached a paging provider or an on-call human',
    evidence: 'docs/integration/ALERTING.md',
  },
  {
    id: 'disaster_recovery_not_measured',
    category: 'operations',
    summary:
      'RPO and RTO are declared configuration with no measurement behind them, and no restore has been attempted at production volume',
    evidence: 'docs/integration/ARENA3D-PRODUCTION-READINESS-CONTINUATION-RECORD.md §4',
  },
  {
    id: 'container_build_unverified',
    category: 'release-artefact',
    summary:
      'the container image has never been built: no container runtime exists in the acceptance sandbox, so the build job is declared and unexecuted',
    evidence: 'docs/integration/CI-AND-DEPLOYMENT-GATES.md',
  },
  {
    id: 'deployment_not_performed',
    category: 'release-artefact',
    summary:
      'nothing has been deployed to any environment, and no deployment configuration has been validated against a running orchestrator',
    evidence: 'docs/integration/SANDBOX-INTEGRATION-READINESS.md',
  },
  {
    id: 'provider_sandbox_acceptance_not_performed',
    category: 'evidence',
    summary:
      'no authorized provider sandbox credential exists here and no provider was contacted, so no provider integration is demonstrated',
    evidence: 'docs/integration/ARENA3D-PRODUCTION-READINESS-CONTINUATION-RECORD.md §5',
  },
  {
    id: 'browser_acceptance_single_engine',
    category: 'evidence',
    summary:
      'browser acceptance ran in one Blink engine with a stubbed API; WebKit and Gecko are unverified and no assistive technology announced a page',
    evidence: 'docs/integration/BROWSER-ACCEPTANCE.md',
  },
  {
    id: 'mobile_not_built_or_submitted',
    category: 'release-artefact',
    summary:
      'neither mobile app has been built, signed, submitted or installed on a device, and both still lack a runtime-version policy',
    evidence: 'docs/integration/MOBILE-RELEASE-READINESS.md',
  },
];

const BROWSER_EVIDENCE_PATH =
  'docs/integration/evidence/browser-acceptance/browser-acceptance.json';

interface BrowserEvidence {
  readonly checks?: readonly { readonly id?: unknown; readonly ok?: unknown }[];
  readonly summary?: { readonly failed?: unknown };
  readonly api?: { readonly origin?: unknown };
}

/**
 * A synthetic input, used by tests to prove the gate is capable of answering `READY`.
 *
 * Deliberately not exported for production use: the repository evaluator never consults it, so no
 * caller can hand this module a friendly input and get a release out of it.
 */
export interface ReleaseGateInput {
  readonly financialDependencyBlockers: readonly string[];
  readonly outstanding: readonly ReleaseBlocker[];
  readonly ci: GateResult;
  readonly mobile: GateResult;
  readonly browser: GateResult;
  readonly mobileConditions: readonly ReleaseCondition[];
}

/** Applies the rules. Pure, so every branch is testable without a repository or a browser. */
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateReport {
  const blockers: ReleaseBlocker[] = [];

  for (const id of input.financialDependencyBlockers) {
    /*
     * The startup gate's own list, not a copy of it. If a dependency is ever verified enough to
     * leave `ProductionReadinessService`, it leaves this report in the same commit — there is no
     * second list to forget.
     */
    blockers.push({
      id,
      category: 'financial-dependency',
      summary:
        'a financial dependency has never been independently verified; the application refuses to start while it is unverified',
      evidence: 'docs/integration/SANDBOX-INTEGRATION-READINESS.md',
    });
  }

  blockers.push(...input.outstanding);

  /*
   * An input gate that is itself broken is a blocker; one that is merely warning is a condition.
   * Collapsing the two would let a failing CI gate arrive as "a note", which is how red pipelines
   * become release notes.
   */
  if (input.ci.verdict === 'ERROR') {
    blockers.push({
      id: 'ci_gate_incomplete',
      category: 'release-artefact',
      summary: input.ci.detail,
      evidence: 'docs/integration/CI-AND-DEPLOYMENT-GATES.md',
    });
  }
  if (input.browser.verdict === 'ERROR') {
    blockers.push({
      id: 'browser_acceptance_failed',
      category: 'evidence',
      summary: input.browser.detail,
      evidence: 'docs/integration/BROWSER-ACCEPTANCE.md',
    });
  }
  if (input.mobile.verdict === 'ERROR') {
    blockers.push({
      id: 'mobile_release_not_registerable',
      category: 'release-artefact',
      summary: input.mobile.detail,
      evidence: 'docs/integration/MOBILE-RELEASE-READINESS.md',
    });
  }

  const conditions: ReleaseCondition[] = [...input.mobileConditions];
  if (input.browser.verdict === 'WARNING') {
    conditions.push({
      id: 'browser_acceptance_partial',
      summary: input.browser.detail,
      evidence: 'docs/integration/BROWSER-ACCEPTANCE.md',
    });
  }
  if (input.ci.verdict === 'WARNING') {
    conditions.push({
      id: 'ci_gate_partial',
      summary: input.ci.detail,
      evidence: 'docs/integration/CI-AND-DEPLOYMENT-GATES.md',
    });
  }

  return {
    verdict: blockers.length === 0 ? 'READY' : 'NOT_READY',
    blockers,
    conditions,
    gates: [input.ci, input.mobile, input.browser],
    notPerformed: [
      'this gate performs no deployment, promotion or rollout',
      'this gate contacts no provider and executes no financial action',
      'this gate has no environment override: nothing in this repository can waive a blocker',
      'this gate does not re-run the evidence it reads; it reads what the other groups recorded',
    ],
  };
}

/** Reads the recorded browser run. A missing or unreadable report is an ERROR, never a pass. */
export function evaluateBrowserEvidence(repoRoot: string): GateResult {
  const path = join(repoRoot, BROWSER_EVIDENCE_PATH);
  if (!existsSync(path)) {
    return {
      gate: 'browser-acceptance',
      verdict: 'ERROR',
      detail: `no recorded browser run at ${BROWSER_EVIDENCE_PATH}; run scripts/admin-web-browser-acceptance.cjs`,
    };
  }

  let evidence: BrowserEvidence;
  try {
    evidence = JSON.parse(readFileSync(path, 'utf8')) as BrowserEvidence;
  } catch (error) {
    return {
      gate: 'browser-acceptance',
      verdict: 'ERROR',
      detail: `the recorded browser run could not be parsed: ${String(error)}`,
    };
  }

  const checks = evidence.checks ?? [];
  const failed = checks.filter((check) => check.ok !== true);
  const stubNote =
    typeof evidence.api?.origin === 'string' && /stub/i.test(evidence.api.origin)
      ? 'the API was stubbed'
      : 'the report does not say whether the API was stubbed';

  if (failed.length > 0) {
    return {
      gate: 'browser-acceptance',
      verdict: 'ERROR',
      detail: `${failed.length} of ${checks.length} browser checks failed; ${stubNote}`,
    };
  }
  if (checks.length === 0) {
    return {
      gate: 'browser-acceptance',
      verdict: 'ERROR',
      detail: `the recorded browser run contains no checks; ${stubNote}`,
    };
  }
  return {
    gate: 'browser-acceptance',
    verdict: 'PASS',
    detail: `${checks.length} browser checks passed; ${stubNote}`,
  };
}

/**
 * Evaluates this repository.
 *
 * Everything it reports is read from the tree — no input is passed in, so there is nothing for a
 * caller to soften.
 */
export function evaluateRepositoryReleaseGate(repoRoot: string): ReleaseGateReport {
  const ciReport = evaluateRepositoryCiGates(repoRoot);
  const mobileReport = evaluateRepositoryMobileRelease(repoRoot);
  const browser = evaluateBrowserEvidence(repoRoot);

  const mobileConditions: ReleaseCondition[] = [];
  for (const finding of mobileReport.findings) {
    if (finding.verdict !== 'WARNING') continue;
    mobileConditions.push({
      id: `mobile_${finding.app}_${finding.check}`,
      summary: finding.detail,
      evidence: 'docs/integration/MOBILE-RELEASE-READINESS.md',
    });
  }

  const mobileErrors = mobileReport.findings.filter((finding) => finding.verdict === 'ERROR');

  return evaluateReleaseGate({
    financialDependencyBlockers: FINANCIAL_DEPENDENCY_BLOCKERS,
    outstanding: OUTSTANDING_REQUIREMENTS,
    ci: {
      gate: 'ci-deployment',
      verdict: ciReport.verdict === 'PASS' ? 'PASS' : 'ERROR',
      detail:
        ciReport.verdict === 'PASS'
          ? `${ciReport.checks.length} CI and deployment gates intact`
          : `CI gates missing: ${ciReport.missing.join(', ')}`,
    },
    mobile: {
      gate: 'mobile-release',
      verdict:
        mobileErrors.length > 0 ? 'ERROR' : mobileReport.verdict === 'PASS' ? 'PASS' : 'WARNING',
      detail:
        mobileErrors.length > 0
          ? `mobile manifests cannot be registered: ${mobileErrors.map((finding) => finding.check).join(', ')}`
          : `mobile manifests are registerable; ${mobileReport.findings.filter((f) => f.verdict === 'WARNING').length} warning(s)`,
    },
    browser,
    mobileConditions,
  });
}
