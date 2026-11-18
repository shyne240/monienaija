/**
 * ARENA 3D Group 35 — platform journeys A–J.
 *
 * ## What a "journey" is here, and what it is not
 *
 * A journey is a named path a real participant takes through the platform, written down as the
 * steps they take and — more importantly — as the things that must **not** happen at each step. It
 * is not a new test framework. Every step is proved by an existing, executed integration suite
 * against real PostgreSQL; this module is the map, and `scripts/run-journey-acceptance.js` is the
 * runner that executes it and records what happened.
 *
 * That choice is deliberate. Writing ten new end-to-end scripts would produce ten new fixtures
 * asserting whatever they were written to assert, while the suites that already exist encode years
 * of decisions about refusals, authorization and ledger balance. Re-running those, grouped by the
 * participant whose path they prove, is worth more than a tenth copy of the same fixture.
 *
 * ## Why the guardrails are the interesting half
 *
 * The happy path is the easy part of a financial platform. What makes a journey safe is the
 * boundary it does not cross: a cash-in that is not a loan, an approval that cannot approve
 * itself, a reconciliation that cannot post an adjustment, an erasure that cannot delete financial
 * evidence. Each journey therefore carries explicit refusals, and the suites that prove them.
 *
 * ## What this does NOT claim
 *
 * - No provider is contacted. Every provider interaction is a controlled fixture.
 * - No real money moves. Every amount is a test fixture inside a disposable database.
 * - No browser, no mobile app and no device takes part; these are API and service-layer journeys.
 * - No deployment exists behind them.
 */

export type JourneyId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

export interface JourneyStep {
  /** What the participant does. */
  readonly step: string;
  /** What the platform must do in response. */
  readonly expected: string;
}

export interface PlatformJourney {
  readonly id: JourneyId;
  readonly title: string;
  readonly actor: string;
  /** Where the path starts: an API route family or a service entry point. */
  readonly entryPoint: string;
  readonly steps: readonly JourneyStep[];
  /** Things that must never happen on this path, however convenient they would be. */
  readonly guardrails: readonly string[];
  /** Integration suites, relative to the repository root, that prove the journey. */
  readonly suites: readonly string[];
}

/**
 * The ten journeys, A–J.
 *
 * Ordered by participant: the customer first (A–D, H), then the agent network (E), then the
 * controls that constrain both (F, G, I, J). An ordering that reads like a story is easier to
 * audit than one that reads like a module index.
 */
export const PLATFORM_JOURNEYS: readonly PlatformJourney[] = [
  {
    id: 'A',
    title: 'A customer registers and becomes usable',
    actor: 'Customer (self-service)',
    entryPoint: 'POST /api/v1/customer/registrations → session',
    steps: [
      {
        step: 'submit a registration with the required identity fields',
        expected: 'the customer is created in an unverified state',
      },
      {
        step: 'verify the registration channel (OTP)',
        expected: 'the account becomes verified; the phone number is not trusted before this',
      },
      {
        step: 'set a transaction PIN',
        expected: 'a PIN is bound to the customer, stored as a verifier, never as the PIN',
      },
      { step: 'open a session', expected: 'a scoped session is issued for that customer only' },
    ],
    guardrails: [
      'an unverified registration cannot transact',
      'a session issued to one customer cannot act for another',
      'the PIN is never stored or logged in plaintext',
    ],
    suites: [
      'test/batch-2a-customer-registration.integration.spec.ts',
      'test/v1-customer-onboarding-01.integration.spec.ts',
    ],
  },
  {
    id: 'B',
    title: 'A customer funds their wallet through an agent',
    actor: 'Customer + Agent',
    entryPoint: 'POST /api/v1/agent/cash-in → customer wallet credit',
    steps: [
      {
        step: 'present cash and a receiving number at an agent outlet',
        expected: 'the agent is identified and authorized to collect',
      },
      {
        step: 'the agent submits the cash-in',
        expected:
          'one ledger transaction credits the customer wallet and debits the agent position',
      },
      {
        step: 'the customer reads their balance',
        expected: 'the credited amount is visible and matches the ledger',
      },
    ],
    guardrails: [
      'a cash-in is not a loan, a transfer or a float movement',
      'a retried submission does not credit twice',
      'the agent cannot spend more than it holds',
    ],
    suites: [
      'test/v1-001-customer-funding.integration.spec.ts',
      'test/a13-agent-cash-in.integration.spec.ts',
    ],
  },
  {
    id: 'C',
    title: 'A customer transfers to another customer',
    actor: 'Customer (sender and recipient)',
    entryPoint: 'POST /api/v1/customer/transfers',
    steps: [
      {
        step: 'the sender names a beneficiary and an amount',
        expected: 'limits and the available balance are evaluated before any movement',
      },
      {
        step: 'the transfer is confirmed with the transaction PIN',
        expected: 'exactly one ledger transaction moves value from sender to recipient',
      },
      {
        step: 'both parties read their history',
        expected: 'each sees their own side and nothing of the other’s',
      },
    ],
    guardrails: [
      'a transfer cannot overdraw a wallet',
      'a transfer above the tier limit is refused, not queued as if approved',
      'the recipient cannot see the sender’s balance or identity beyond what is declared',
    ],
    suites: ['test/a5-transfer-lifecycle.integration.spec.ts'],
  },
  {
    id: 'D',
    title: 'A customer withdraws cash through an agent',
    actor: 'Customer + Agent',
    entryPoint: 'POST /api/v1/agent/cash-out',
    steps: [
      {
        step: 'the customer presents a withdrawal identity and amount',
        expected: 'the agent validates the customer and the PIN',
      },
      {
        step: 'the agent disburses cash',
        expected:
          'one ledger transaction debits the customer wallet and credits the agent position',
      },
    ],
    guardrails: [
      'a withdrawal is refused when the wallet is short, and refusal moves nothing',
      'a duplicated submission cannot pay out twice',
      'an agent cannot withdraw against a customer it is not authorized to serve',
    ],
    suites: ['test/a14-agent-cash-out.integration.spec.ts'],
  },
  {
    id: 'E',
    title: 'An agent is funded and its float is classified',
    actor: 'Agent + workforce operator',
    entryPoint: 'POST /api/v1/admin/agent-funding → agent position',
    steps: [
      {
        step: 'an operator funds an agent position',
        expected: 'the position increases and the funding is attributed to a pool',
      },
      {
        step: 'the agent reads its position',
        expected: 'the position reconciles to the ledger, with the pool classification visible',
      },
    ],
    guardrails: [
      'an institution-attributed agent is never funded from the unattributed platform pool',
      'funding an agent does not create institution-bound money out of nothing',
      'pending classified funds are visible as pending, never as available',
    ],
    suites: ['test/a3d-agent-float-funding.integration.spec.ts'],
  },
  {
    id: 'F',
    title: 'A financial commitment needs two people',
    actor: 'Finance preparer → finance approver',
    entryPoint: 'POST /api/v1/finance/commitments → approval inbox → execute',
    steps: [
      {
        step: 'a preparer records a commitment',
        expected: 'the commitment is stored in a pending state and moves nothing',
      },
      {
        step: 'a different principal approves it',
        expected: 'the approval is recorded against the commitment',
      },
      {
        step: 'the commitment executes',
        expected: 'exactly one ledger effect occurs, bound to the approved commitment',
      },
    ],
    guardrails: [
      'the preparer cannot approve their own commitment',
      'a rejected commitment cannot be executed',
      'execution cannot occur twice for one commitment',
    ],
    suites: [
      'test/financial-commitment-initiation.integration.spec.ts',
      'test/v1-funding-approvals-inbox.integration.spec.ts',
    ],
  },
  {
    id: 'G',
    title: 'Provider settlement is reconciled, not assumed',
    actor: 'Operations + reconciliation engine',
    entryPoint: 'banking reconciliation service',
    steps: [
      {
        step: 'a provider statement is ingested',
        expected: 'statement lines are stored and matched against internal records',
      },
      {
        step: 'a mismatch is found',
        expected: 'an exception is raised and nothing is auto-adjusted',
      },
      {
        step: 'an operator resolves the exception',
        expected: 'the resolution is recorded as an explicit, attributable act',
      },
    ],
    guardrails: [
      'reconciliation never posts a ledger adjustment on its own',
      'an unmatched line is reported, not dropped',
      'an unknown provider reference is never reported as settled',
    ],
    suites: ['test/banking-reconciliation.integration.spec.ts'],
  },
  {
    id: 'H',
    title: 'KYC tiering decides what a customer may do',
    actor: 'Customer + compliance',
    entryPoint: 'KYC queue and tier policy',
    steps: [
      {
        step: 'a customer submits documents for a higher tier',
        expected: 'the submission lands in the review queue, not in an approved state',
      },
      {
        step: 'compliance reviews and decides',
        expected: 'the decision records who decided and on what basis',
      },
      {
        step: 'the new tier takes effect',
        expected: 'limits change only after the decision, never before',
      },
    ],
    guardrails: [
      'a pending KYC submission grants no additional limit',
      'a tier cannot be raised without a recorded decision',
      'provider-supplied verdicts are evidence, not authorization',
    ],
    suites: ['test/kyc-fixture-contract.integration.spec.ts'],
  },
  {
    id: 'I',
    title: 'Risk signals become cases, and cases get decisions',
    actor: 'Risk analyst',
    entryPoint: 'POST /api/v1/risk/fraud-cases',
    steps: [
      {
        step: 'signals are evaluated for a transaction',
        expected: 'signals are recorded with their basis',
      },
      { step: 'a case is opened', expected: 'the case references the signals that raised it' },
      {
        step: 'an analyst records a decision',
        expected: 'the decision is attributable and auditable',
      },
    ],
    guardrails: [
      'detection never moves money and never blocks silently',
      'no threshold is invented: an unspecified threshold is reported, not defaulted',
      'an analyst decision cannot delete the signals that motivated it',
    ],
    suites: ['test/fraud-detection.integration.spec.ts'],
  },
  {
    id: 'J',
    title: 'A customer’s data is erased without erasing the ledger',
    actor: 'Customer + privacy operator',
    entryPoint: 'POST /api/v1/privacy/erasure-requests',
    steps: [
      {
        step: 'a customer requests erasure',
        expected: 'the request is recorded with the legal basis for what may be erased',
      },
      {
        step: 'erasure executes',
        expected: 'personal data is anonymised and financial records are retained',
      },
      {
        step: 'the audit trail is read',
        expected: 'the erasure itself is visible in the audit trail',
      },
    ],
    guardrails: [
      'erasure never deletes financial or audit records',
      'retention periods are not shortened to satisfy an erasure request',
      'an erasure cannot be performed without a recorded basis',
    ],
    suites: ['test/privacy-retention.integration.spec.ts'],
  },
];

export type SuiteStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'MISSING';

export interface SuiteResult {
  readonly file: string;
  readonly status: SuiteStatus;
  readonly tests: number;
  readonly failed: number;
  readonly durationMs: number;
  readonly detail?: string;
}

export interface JourneyResult {
  readonly id: JourneyId;
  readonly title: string;
  readonly suites: readonly SuiteResult[];
  readonly verdict: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly tests: number;
}

export interface JourneyAcceptanceReport {
  readonly generatedAt: string;
  readonly command: string;
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly disposableCluster: boolean;
  };
  readonly journeys: readonly JourneyResult[];
  readonly summary: {
    readonly journeys: number;
    readonly passed: number;
    readonly failed: number;
    readonly notRun: number;
    readonly tests: number;
  };
  readonly notPerformed: readonly string[];
}

export interface RawSuiteOutcome {
  readonly file: string;
  /** Jest's own verdict for the file: a teardown throw is a failure even with zero red assertions. */
  readonly status: 'PASS' | 'FAIL';
  readonly tests: number;
  readonly failed: number;
  readonly durationMs: number;
  readonly detail?: string;
}

/**
 * Turns raw suite outcomes into per-journey verdicts.
 *
 * A journey passes only when **every** suite that proves it ran and passed. A missing suite is
 * `NOT_RUN`, never a pass — the failure mode this guards against is a suite being renamed and the
 * acceptance quietly reporting green because it has nothing left to check.
 */
export function evaluateJourneyResults(
  journeys: readonly PlatformJourney[],
  outcomes: readonly RawSuiteOutcome[],
  missingFiles: readonly string[],
): readonly JourneyResult[] {
  const byFile = new Map(outcomes.map((outcome) => [outcome.file, outcome]));
  const missing = new Set(missingFiles);

  return journeys.map((journey) => {
    const suites: SuiteResult[] = journey.suites.map((file) => {
      if (missing.has(file)) {
        return {
          file,
          status: 'MISSING',
          tests: 0,
          failed: 0,
          durationMs: 0,
          detail: 'file not found',
        };
      }
      const outcome = byFile.get(file);
      if (!outcome) {
        return {
          file,
          status: 'NOT_RUN',
          tests: 0,
          failed: 0,
          durationMs: 0,
          detail: 'no result recorded',
        };
      }
      if (outcome.status === 'FAIL' || outcome.failed > 0 || outcome.tests === 0) {
        return {
          file,
          status: 'FAIL',
          tests: outcome.tests,
          failed: outcome.failed,
          durationMs: outcome.durationMs,
          detail: outcome.detail ?? `${String(outcome.failed)} failing of ${String(outcome.tests)}`,
        };
      }
      return {
        file,
        status: 'PASS',
        tests: outcome.tests,
        failed: outcome.failed,
        durationMs: outcome.durationMs,
      };
    });

    const tests = suites.reduce((total, suite) => total + suite.tests, 0);
    const verdict = suites.some((suite) => suite.status === 'FAIL' || suite.status === 'MISSING')
      ? 'FAIL'
      : suites.some((suite) => suite.status === 'NOT_RUN')
        ? 'NOT_RUN'
        : 'PASS';

    return { id: journey.id, title: journey.title, suites, verdict, tests };
  });
}

/** Summarises a report. Kept separate so the runner and the tests compute the same numbers. */
export function summariseJourneys(
  results: readonly JourneyResult[],
): JourneyAcceptanceReport['summary'] {
  return {
    journeys: results.length,
    passed: results.filter((result) => result.verdict === 'PASS').length,
    failed: results.filter((result) => result.verdict === 'FAIL').length,
    notRun: results.filter((result) => result.verdict === 'NOT_RUN').length,
    tests: results.reduce((total, result) => total + result.tests, 0),
  };
}
