/**
 * B2T05 — B2 activation workflow frozen constants.
 *
 * The B2 activation workflow is the customer/merchant/agent activation
 * workflow engine for the bounded first cohort
 * `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first scope
 * `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT`
 * v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit
 * `CUSTOMER_FUNDS`, region `NG`. It consumes B2T03 customer readiness and
 * B2T04 merchant/agent readiness through their consumer ports only and
 * never recalculates readiness. Activation is allowed only when the
 * readiness outcome is ATTESTED_READY. The workflow is deterministic and
 * replay-safe with a dedicated idempotency scope. It preserves all A1–A7
 * and B1 authority boundaries and never posts a ledger entry.
 */

export const B2_ACTIVATION_WORKFLOW_CONTRACT_NAME = 'B2-ACTIVATION-WORKFLOW' as const;

export const B2_ACTIVATION_WORKFLOW_CONTRACT_VERSION = 1 as const;

export const B2_ACTIVATION_WORKFLOW_CONTRACT_DOCUMENT =
  'docs/B2-COMMERCIAL-ACTIVATION-CONTRACT.md' as const;

export const B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE =
  'b2.activation-workflow.idempotency.v1' as const;

export const B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

export const B2_ACTIVATION_WORKFLOW_AUDIT_ACTOR = 'b2-activation-workflow' as const;

export const B2_ACTIVATION_WORKFLOW_AUDIT_ENTITY_TYPE = 'b2_activation' as const;

export const B2_ACTIVATION_WORKFLOW_OUTBOX_EVENT_TYPE = 'b2.activation.decided.v1' as const;

export const B2_ACTIVATION_WORKFLOW_OUTBOX_CLASSIFICATION = 'INTERNAL' as const;

export const B2_ACTIVATION_WORKFLOW_OUTBOX_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

export const B2_ACTIVATION_WORKFLOW_REFERENCE_PREFIX = 'b2-activation' as const;

export const B2_ACTIVATION_WORKFLOW_COHORT_KEY = 'b2.activation.cohort.inbound-funding' as const;

export const B2_ACTIVATION_WORKFLOW_COHORT_VERSION = 1 as const;

export const B2_ACTIVATION_WORKFLOW_B1_SCOPE_KEY =
  'commercial.virtual-account.inbound-funding' as const;

export const B2_ACTIVATION_WORKFLOW_B1_SCOPE_VERSION = 1 as const;

export const B2_ACTIVATION_WORKFLOW_A7_PRODUCT_KEY = 'VIRTUAL_ACCOUNT' as const;

export const B2_ACTIVATION_WORKFLOW_A7_PRODUCT_VERSION = 1 as const;

export const B2_ACTIVATION_WORKFLOW_A6_PARTNER_KEY = 'NIBSS_NIP' as const;

export const B2_ACTIVATION_WORKFLOW_CURRENCY = 'NGN' as const;

export const B2_ACTIVATION_WORKFLOW_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;

export const B2_ACTIVATION_WORKFLOW_REGION = 'NG' as const;

export const B2_ACTIVATION_WORKFLOW_STATES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const;

export const B2_ACTIVATION_WORKFLOW_STATE_PENDING = 'PENDING' as const;
export const B2_ACTIVATION_WORKFLOW_STATE_ACTIVE = 'ACTIVE' as const;
export const B2_ACTIVATION_WORKFLOW_STATE_SUSPENDED = 'SUSPENDED' as const;
export const B2_ACTIVATION_WORKFLOW_STATE_REVOKED = 'REVOKED' as const;

export const B2_ACTIVATION_WORKFLOW_OUTCOMES = [
  'ACTIVATED',
  'REJECTED',
  'SUSPENDED',
  'REVOKED',
  'PENDING',
] as const;

export const B2_ACTIVATION_WORKFLOW_FAILURE_CODES = [
  'B2_ACTIVATION_WORKFLOW_INVALID_COMMAND',
  'B2_ACTIVATION_WORKFLOW_INCOMPATIBLE',
  'B2_ACTIVATION_WORKFLOW_QUERY_UNAVAILABLE',
  'B2_ACTIVATION_WORKFLOW_PROHIBITED',
  'B2_ACTIVATION_WORKFLOW_READINESS_NOT_READY',
  'B2_ACTIVATION_WORKFLOW_REPLAY_CONFLICT',
  'B2_ACTIVATION_WORKFLOW_REPLAY_EXPIRED',
  'B2_ACTIVATION_WORKFLOW_IN_PROGRESS',
  'B2_ACTIVATION_WORKFLOW_NOT_FOUND',
  'B2_ACTIVATION_WORKFLOW_INVALID_STATE_TRANSITION',
] as const;

export const B2_ACTIVATION_WORKFLOW_RULE_KINDS = [
  'READINESS_CONSUMPTION',
  'COHORT_COMPATIBILITY',
  'B1_SCOPE_COMPATIBILITY',
  'ACTIVATION_STATE_MACHINE',
] as const;

export const B2_ACTIVATION_WORKFLOW_RULE_OUTCOMES = [
  'PASS',
  'FAIL',
  'SKIP',
  'NOT_APPLICABLE',
] as const;

export const B2_ACTIVATION_WORKFLOW_RETENTION_DAYS = 365 as const;

export const B2_ACTIVATION_WORKFLOW_DATA_CLASSIFICATION = 'INTERNAL' as const;
