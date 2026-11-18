/**
 * ARENA 3D Group 36 — the consolidated acceptance matrix.
 *
 * ## What this is for
 *
 * By the end of the mission there are thirty-five groups of evidence in this repository, and no
 * single page that says which of them were *executed here*, which are *recorded from an earlier
 * run*, and which were *never possible at all*. Those three are easy to blur in prose and
 * impossible to blur in a table with a column for it.
 *
 * The matrix therefore has exactly one idea: every requirement is classified by the strength of the
 * proof behind it, and the classification is derived from what the run actually did.
 *
 * - `executed` — the script that writes this matrix ran the command in this session.
 * - `recorded` — an artefact from an earlier group exists and is readable; it was not re-run.
 * - `unavailable` — no proof exists and none can be produced in this environment, with the reason.
 *
 * `unavailable` is not a failure and it is not a pass. Reporting it as either is how a mission
 * ends up claiming a container build it never ran.
 */

export type EvidenceKind = 'executed' | 'recorded' | 'unavailable';

export interface MatrixRequirement {
  readonly id: string;
  readonly area: string;
  readonly requirement: string;
  readonly kind: EvidenceKind;
  /** The command that proves it, or the artefact that records it, or why it cannot be produced. */
  readonly evidence: string;
}

export type MatrixStatus = 'PASS' | 'FAIL' | 'NOT_READY' | 'UNAVAILABLE' | 'MISSING';

export interface MatrixEntry {
  readonly id: string;
  readonly status: MatrixStatus;
  readonly detail: string;
}

export interface ConsolidatedMatrixReport {
  readonly generatedAt: string;
  readonly commit: string;
  readonly cleanTree: boolean;
  readonly rows: readonly (MatrixRequirement & { readonly status: MatrixStatus; readonly detail: string })[];
  readonly summary: {
    readonly requirements: number;
    readonly executed: number;
    readonly recorded: number;
    readonly unavailable: number;
    readonly failing: number;
  };
  readonly releaseVerdict: string;
  readonly notClaimed: readonly string[];
}

/**
 * The mission's requirements, one row each.
 *
 * The `unavailable` rows are as important as the rest: they are the list a reader would otherwise
 * have to reconstruct from six separate documents, and every one of them is a thing this mission was
 * instructed not to fake.
 */
export const CONSOLIDATED_MATRIX: readonly MatrixRequirement[] = [
  {
    id: 'typescript',
    area: 'engineering',
    requirement: 'the repository type-checks under its own strict configuration',
    kind: 'executed',
    evidence: 'npx tsc --noEmit -p tsconfig.json',
  },
  {
    id: 'lint',
    area: 'engineering',
    requirement: 'src and test lint clean (split, because a whole-repo run exhausts this box)',
    kind: 'executed',
    evidence: 'npm run lint',
  },
  {
    id: 'format',
    area: 'engineering',
    requirement: 'every in-scope file matches the formatter',
    kind: 'executed',
    evidence: 'npm run format:check',
  },
  {
    id: 'unit-suite',
    area: 'engineering',
    requirement: 'the whole unit suite passes in one run',
    kind: 'executed',
    evidence: 'npx jest --config jest.config.js',
  },
  {
    id: 'ci-gates',
    area: 'delivery',
    requirement: 'every required CI job exists and invokes the script it claims to run',
    kind: 'executed',
    evidence: 'evaluateRepositoryCiGates() over .github/workflows/ci.yml',
  },
  {
    id: 'release-gate',
    area: 'delivery',
    requirement: 'the release verdict is derived, not asserted',
    kind: 'executed',
    evidence: 'evaluateRepositoryReleaseGate()',
  },
  {
    id: 'journeys',
    area: 'product',
    requirement: 'the ten participant journeys run against real PostgreSQL',
    kind: 'recorded',
    evidence: 'docs/integration/evidence/journeys/journey-results.json',
  },
  {
    id: 'browser',
    area: 'product',
    requirement: 'the admin console boots, authenticates and scopes itself in a real browser engine',
    kind: 'recorded',
    evidence: 'docs/integration/evidence/browser-acceptance/browser-acceptance.json',
  },
  {
    id: 'mobile-manifests',
    area: 'product',
    requirement: 'both mobile manifests are registerable, submittable and identifiable',
    kind: 'executed',
    evidence: 'evaluateRepositoryMobileRelease()',
  },
  {
    id: 'postgres-inventory',
    area: 'database',
    requirement: 'every integration suite is claimed by a runner that CI invokes',
    kind: 'recorded',
    evidence: 'src/deployment/postgres-acceptance.service.ts (inventory is static: wired, not proven)',
  },
  {
    id: 'privacy-retention',
    area: 'compliance',
    requirement: 'erasure anonymises personal data and never deletes financial evidence',
    kind: 'recorded',
    evidence: 'test/privacy-retention.integration.spec.ts — executed inside journey J',
  },
  {
    id: 'performance',
    area: 'operations',
    requirement: 'query plans are asserted on shape, not on wall-clock in a noisy sandbox',
    kind: 'recorded',
    evidence: 'docs/integration/PERFORMANCE-ACCEPTANCE.md',
  },
  {
    id: 'startup-gate',
    area: 'operations',
    requirement: 'the application refuses to start while financial dependencies are unverified',
    kind: 'recorded',
    evidence: 'test/sandbox-integration-readiness.integration.spec.ts',
  },
  {
    id: 'container-build',
    area: 'delivery',
    requirement: 'the container image builds',
    kind: 'unavailable',
    evidence: 'no container runtime exists in this environment; the CI job is declared and unexecuted here',
  },
  {
    id: 'deployment',
    area: 'delivery',
    requirement: 'the application is deployed and serves traffic',
    kind: 'unavailable',
    evidence: 'no environment, orchestrator or registry exists here; nothing was deployed',
  },
  {
    id: 'provider-sandbox',
    area: 'providers',
    requirement: 'a real provider contract is exercised in a provider sandbox',
    kind: 'unavailable',
    evidence: 'no authorized provider credential was supplied and provider calls are outside this mission',
  },
  {
    id: 'cross-browser',
    area: 'product',
    requirement: 'the console works in WebKit and Gecko as well as Blink',
    kind: 'unavailable',
    evidence: 'only a Blink build could be obtained; no WebKit or Gecko engine is available here',
  },
  {
    id: 'mobile-build',
    area: 'product',
    requirement: 'both mobile apps are built, signed, submitted and installed',
    kind: 'unavailable',
    evidence: 'no Xcode, no Android SDK, no signing identity, no store account, no device',
  },
  {
    id: 'restore-at-volume',
    area: 'operations',
    requirement: 'a restore is attempted at production volume and RPO/RTO are measured',
    kind: 'unavailable',
    evidence: 'no production-scale dataset exists here; recovery objectives remain declared, not measured',
  },
  {
    id: 'worker-execution',
    area: 'operations',
    requirement: 'a deployable mechanism guarantees essential background workers run',
    kind: 'unavailable',
    evidence: 'supervision observes; no invocation mechanism is provisioned or tested (standing requirement)',
  },
  {
    id: 'alert-delivery',
    area: 'operations',
    requirement: 'an alert reaches a real channel and is receipted',
    kind: 'unavailable',
    evidence: 'delivery is dark by default; no channel endpoint was configured or contacted',
  },
];

/** The list a reader must not have to reconstruct from six documents. */
export const NOT_CLAIMED: readonly string[] = [
  'container build success',
  'docker compose validation',
  'any deployment or rollout',
  'provider sandbox acceptance or entitlement',
  'an executed financial transaction with real money',
  'store approval, signing or submission of either mobile app',
  'second- and third-engine browser acceptance',
  'screen-reader or assistive-technology acceptance',
  'a restore at production volume, or a measured RPO/RTO',
  'a delivered alert, or automated worker execution in a deployment',
  'that an isolated-PostgreSQL suite passed in this environment',
];

/** Applies the run's outcomes to the requirements, keeping every row and its kind. */
export function evaluateConsolidatedMatrix(
  requirements: readonly MatrixRequirement[],
  entries: readonly MatrixEntry[],
): Omit<ConsolidatedMatrixReport, 'generatedAt' | 'commit' | 'cleanTree' | 'releaseVerdict'> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  const rows = requirements.map((requirement) => {
    const entry = byId.get(requirement.id);
    if (!entry) {
      return {
        ...requirement,
        status: 'MISSING' as MatrixStatus,
        detail: 'the run recorded no outcome for this requirement',
      };
    }
    return { ...requirement, status: entry.status, detail: entry.detail };
  });

  return {
    rows,
    summary: {
      requirements: rows.length,
      executed: rows.filter((row) => row.kind === 'executed').length,
      recorded: rows.filter((row) => row.kind === 'recorded').length,
      unavailable: rows.filter((row) => row.kind === 'unavailable').length,
      failing: rows.filter((row) => row.status === 'FAIL' || row.status === 'MISSING').length,
    },
    notClaimed: [...NOT_CLAIMED],
  };
}
