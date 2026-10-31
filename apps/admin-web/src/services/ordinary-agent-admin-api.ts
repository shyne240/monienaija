import { ApiClient, ApiError } from './api-client';

/**
 * Canonical Ordinary Agent V1 service identifiers matching backend `src/agent/agent-service.enum.ts`.
 * Legacy aliases (`CASH_TO_WALLET` -> `CASH_IN`, `WALLET_TO_CASH` -> `CASH_OUT`) are normalized
 * into canonical codes when loading existing class definitions so operators never persist freeform
 * or non-canonical service identifiers.
 */
export type CanonicalAgentServiceCode =
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'CASH_TO_CASH'
  | 'AGENT_FUNDING'
  | 'AGENT_DEFUNDING';

export interface CanonicalAgentServiceOption {
  code: CanonicalAgentServiceCode;
  label: string;
  description: string;
}

export const CANONICAL_AGENT_SERVICES: readonly CanonicalAgentServiceOption[] = [
  {
    code: 'CASH_IN',
    label: 'Cash-In (Cash → Customer Wallet)',
    description: 'Agent accepts physical cash and credits a customer wallet.',
  },
  {
    code: 'CASH_OUT',
    label: 'Cash-Out (Customer Wallet → Cash)',
    description: 'Customer debits wallet and collects physical cash at the Agent desk.',
  },
  {
    code: 'CASH_TO_CASH',
    label: 'Cash-to-Cash Transfer',
    description: 'Walk-in cash remittance claimable via customer wallet or Agent cash payout.',
  },
  {
    code: 'AGENT_FUNDING',
    label: 'Agent Float Funding',
    description: 'Authorized maker-checker funding into the Agent NGN float wallet.',
  },
  {
    code: 'AGENT_DEFUNDING',
    label: 'Agent Float Defunding',
    description: 'Authorized maker-checker defunding from the Agent NGN float wallet.',
  },
] as const;

const CANONICAL_SERVICE_SET = new Set<string>(
  CANONICAL_AGENT_SERVICES.map((service) => service.code),
);

const LEGACY_SERVICE_ALIASES: Readonly<Record<string, CanonicalAgentServiceCode>> = {
  CASH_TO_WALLET: 'CASH_IN',
  WALLET_TO_CASH: 'CASH_OUT',
};

export interface NormalizedApplicableServices {
  canonical: CanonicalAgentServiceCode[];
  legacyAliasesMapped: Array<{ from: string; to: CanonicalAgentServiceCode }>;
  unknownTokens: string[];
  nonArrayConfigured: boolean;
}

export function normalizeApplicableServicesInput(raw: unknown): NormalizedApplicableServices {
  if (raw === null || raw === undefined) {
    return {
      canonical: [],
      legacyAliasesMapped: [],
      unknownTokens: [],
      nonArrayConfigured: false,
    };
  }

  let items: unknown[];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'object' && Array.isArray((raw as { services?: unknown }).services)) {
    items = (raw as { services: unknown[] }).services;
  } else {
    return {
      canonical: [],
      legacyAliasesMapped: [],
      unknownTokens: [],
      nonArrayConfigured: true,
    };
  }

  const selected = new Set<CanonicalAgentServiceCode>();
  const legacyAliasesMapped: Array<{ from: string; to: CanonicalAgentServiceCode }> = [];
  const unknownTokens: string[] = [];

  for (const entry of items) {
    const token =
      typeof entry === 'string'
        ? entry.trim().toUpperCase()
        : entry && typeof entry === 'object' && typeof (entry as { code?: unknown }).code === 'string'
          ? ((entry as { code: string }).code).trim().toUpperCase()
          : String(entry ?? '').trim();

    if (!token) continue;
    if (CANONICAL_SERVICE_SET.has(token)) {
      selected.add(token as CanonicalAgentServiceCode);
    } else if (LEGACY_SERVICE_ALIASES[token]) {
      const target = LEGACY_SERVICE_ALIASES[token];
      selected.add(target);
      legacyAliasesMapped.push({ from: token, to: target });
    } else {
      unknownTokens.push(token);
    }
  }

  const ordered = CANONICAL_AGENT_SERVICES
    .map((option) => option.code)
    .filter((code) => selected.has(code));

  return {
    canonical: ordered,
    legacyAliasesMapped,
    unknownTokens,
    nonArrayConfigured: false,
  };
}

export function summarizeCanonicalServices(value: unknown): string {
  if (value === null || value === undefined) return 'Not configured';
  const normalized = normalizeApplicableServicesInput(value);
  if (normalized.nonArrayConfigured) return 'Non-standard object';
  if (normalized.canonical.length === 0 && normalized.unknownTokens.length === 0) {
    return 'None enabled';
  }
  const parts: string[] = [...normalized.canonical];
  if (normalized.unknownTokens.length > 0) {
    parts.push(`+${normalized.unknownTokens.length} non-canonical`);
  }
  return parts.join(', ');
}

/**
 * Extracts required field or document-category keys declared on an `AgentClass` record
 * (`requiredInformation` / `requiredDocumentCategories` JSONB columns) without inventing
 * KYC policy defaults when the class leaves them `null`.
 */
export function extractClassRequirementKeys(raw: unknown): string[] {
  if (!raw) return [];
  const keys: string[] = [];
  const collectFromArray = (items: unknown[]) => {
    for (const item of items) {
      if (typeof item === 'string' && item.trim()) {
        keys.push(item.trim());
      } else if (item && typeof item === 'object') {
        const candidate =
          (item as Record<string, unknown>).key ??
          (item as Record<string, unknown>).code ??
          (item as Record<string, unknown>).category ??
          (item as Record<string, unknown>).field ??
          (item as Record<string, unknown>).name;
        if (typeof candidate === 'string' && candidate.trim()) {
          keys.push(candidate.trim());
        }
      }
    }
  };

  if (Array.isArray(raw)) {
    collectFromArray(raw);
  } else if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.fields)) collectFromArray(obj.fields);
    else if (Array.isArray(obj.categories)) collectFromArray(obj.categories);
    else if (Array.isArray(obj.required)) collectFromArray(obj.required);
    else {
      for (const [k, v] of Object.entries(obj)) {
        if (v !== false && v !== null && v !== undefined && k.trim()) {
          keys.push(k.trim());
        }
      }
    }
  }

  return Array.from(new Set(keys));
}

// ============================================================================
// Existing Live Agent Application Onboarding Contracts (`9588329` baseline)
// ============================================================================

export interface AgentApplicationDraftResponse {
  id: string;
  reference: string;
  agentClassId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | string;
  applicantReference: string;
  businessName: string | null;
  contactEmail: string | null;
  payload?: Record<string, unknown> | null;
  version?: number;
  agentId: string | null;
  rejectionReason: string | null;
  createdAt: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  /**
   * Returned once by `POST /agents/applications` for unauthenticated applicants.
   * Workforce operators authenticate via `agent.review_application` bearer sessions,
   * so Admin Web deliberately ignores and never persists this token.
   */
  applicantAccessToken?: string;
}

export interface CreateAgentApplicationInput {
  applicantReference: string;
  agentClassId?: string;
  agentClassReference?: string;
  businessName?: string;
  contactEmail?: string;
  payload?: Record<string, unknown>;
}

export interface UpdateAgentApplicationDraftInput {
  agentClassId?: string;
  businessName?: string;
  contactEmail?: string;
  payload?: Record<string, unknown>;
  expectedVersion?: number;
}

function stripApplicantToken(
  record: AgentApplicationDraftResponse,
): Omit<AgentApplicationDraftResponse, 'applicantAccessToken'> {
  if (!record || typeof record !== 'object') return record;
  const { applicantAccessToken: _discarded, ...rest } = record;
  return rest;
}

export async function createAgentApplicationDraft(
  input: CreateAgentApplicationInput,
): Promise<Omit<AgentApplicationDraftResponse, 'applicantAccessToken'>> {
  const body: Record<string, unknown> = {
    applicantReference: input.applicantReference.trim(),
  };
  if (input.agentClassId?.trim()) body.agentClassId = input.agentClassId.trim();
  else if (input.agentClassReference?.trim()) body.agentClassReference = input.agentClassReference.trim();
  if (input.businessName !== undefined && input.businessName.trim()) {
    body.businessName = input.businessName.trim();
  }
  if (input.contactEmail !== undefined && input.contactEmail.trim()) {
    body.contactEmail = input.contactEmail.trim();
  }
  if (input.payload && Object.keys(input.payload).length > 0) {
    body.payload = input.payload;
  }

  const created = await ApiClient.post<AgentApplicationDraftResponse>('/agents/applications', body);
  return stripApplicantToken(created);
}

export async function updateAgentApplicationDraft(
  applicationId: string,
  input: UpdateAgentApplicationDraftInput,
): Promise<Omit<AgentApplicationDraftResponse, 'applicantAccessToken'>> {
  const body: Record<string, unknown> = {};
  if (input.agentClassId?.trim()) body.agentClassId = input.agentClassId.trim();
  if (input.businessName !== undefined) body.businessName = input.businessName.trim();
  if (input.contactEmail !== undefined) body.contactEmail = input.contactEmail.trim();
  if (input.payload !== undefined) body.payload = input.payload;
  if (typeof input.expectedVersion === 'number') body.expectedVersion = input.expectedVersion;

  const updated = await ApiClient.patch<AgentApplicationDraftResponse>(
    `/agents/applications/${encodeURIComponent(applicationId)}`,
    body,
  );
  return stripApplicantToken(updated);
}

export async function submitAgentApplicationDraft(
  applicationId: string,
): Promise<Omit<AgentApplicationDraftResponse, 'applicantAccessToken'>> {
  const submitted = await ApiClient.post<AgentApplicationDraftResponse>(
    `/agents/applications/${encodeURIComponent(applicationId)}/submit`,
  );
  return stripApplicantToken(submitted);
}

// ============================================================================
// Cross-Arena Integration Boundary for Arena 1 Endpoints (Mission 15A <-> 15B)
// ============================================================================

/**
 * Explicit integration result matching the Admin Web cross-arena boundary pattern
 * (`notification-management-api.ts`). `404` and `501` indicate the Arena 1 endpoint is not yet
 * active on the connected backend build; Admin Web surfaces an honest dependency notice without
 * fabricating a response or claiming a mutation succeeded. All other HTTP errors (`400`, `401`,
 * `403`, `409`, `500`) rethrow so real validation, permission, or version-conflict errors surface.
 */
export type Arena1IntegrationResult<T> =
  | { status: 'LIVE'; data: T }
  | {
      status: 'BLOCKED';
      owner: 'ARENA_1';
      method: 'GET' | 'POST' | 'PATCH';
      endpoint: string;
      httpStatus: 404 | 501;
      message: string;
    };

function statusCodeOf(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  if (error && typeof error === 'object' && 'status' in error) {
    const numeric = Number((error as { status?: unknown }).status);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

async function callArena1Boundary<T>(
  method: 'GET' | 'POST' | 'PATCH',
  endpoint: string,
  description: string,
  exec: () => Promise<T>,
): Promise<Arena1IntegrationResult<T>> {
  try {
    const data = await exec();
    return { status: 'LIVE', data };
  } catch (error) {
    const httpStatus = statusCodeOf(error);
    if (httpStatus === 404 || httpStatus === 501) {
      return {
        status: 'BLOCKED',
        owner: 'ARENA_1',
        method,
        endpoint,
        httpStatus,
        message: `${description} awaits Arena 1 backend endpoint (${method} ${endpoint}, HTTP ${httpStatus}). No state was modified.`,
      };
    }
    throw error;
  }
}

/**
 * Backend `UpdateOutletMetadataDto` accepts ONLY these mutable location fields plus
 * `expectedVersion`. `code`, `reference`, ownership and lifecycle are deliberately not editable
 * through this route, and `src/main.ts` configures `forbidNonWhitelisted: true`, so sending
 * `code` returns 400 for every save. It is therefore omitted here rather than forwarded.
 */
export interface UpdateAgentOutletMetadataInput {
  name?: string;
  displayName?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  expectedVersion?: number;
}

export async function updateAgentOutletMetadata<T = Record<string, unknown>>(
  outletId: string,
  input: UpdateAgentOutletMetadataInput,
): Promise<Arena1IntegrationResult<T>> {
  const endpoint = `/internal/outlets/${encodeURIComponent(outletId)}`;
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name.trim();
  if (input.displayName !== undefined) {
    body.displayName = input.displayName?.trim() ? input.displayName.trim() : null;
  }
  if (input.addressLine !== undefined) {
    body.addressLine = input.addressLine?.trim() ? input.addressLine.trim() : null;
  }
  if (input.city !== undefined) body.city = input.city?.trim() ? input.city.trim() : null;
  if (input.state !== undefined) body.state = input.state?.trim() ? input.state.trim() : null;
  if (input.country !== undefined) {
    body.country = input.country?.trim() ? input.country.trim() : null;
  }
  if (typeof input.expectedVersion === 'number') {
    body.expectedVersion = input.expectedVersion;
  }

  return callArena1Boundary<T>('PATCH', endpoint, 'Outlet metadata update', () =>
    ApiClient.patch<T>(endpoint, body),
  );
}

/**
 * Backend `UpdateTerminalMetadataDto` accepts ONLY `label`, `serialNumber` and `expectedVersion`;
 * `code`, `reference` and lifecycle are not editable here. See the outlet note above — the
 * global whitelist pipe rejects unknown properties with 400.
 */
export interface UpdateAgentTerminalMetadataInput {
  label?: string | null;
  serialNumber?: string | null;
  expectedVersion?: number;
}

export async function updateAgentTerminalMetadata<T = Record<string, unknown>>(
  terminalId: string,
  input: UpdateAgentTerminalMetadataInput,
): Promise<Arena1IntegrationResult<T>> {
  const endpoint = `/internal/terminals/${encodeURIComponent(terminalId)}`;
  const body: Record<string, unknown> = {};
  if (input.label !== undefined) body.label = input.label?.trim() ? input.label.trim() : null;
  if (input.serialNumber !== undefined) {
    body.serialNumber = input.serialNumber?.trim() ? input.serialNumber.trim() : null;
  }
  if (typeof input.expectedVersion === 'number') {
    body.expectedVersion = input.expectedVersion;
  }

  return callArena1Boundary<T>('PATCH', endpoint, 'Terminal metadata update', () =>
    ApiClient.patch<T>(endpoint, body),
  );
}

export interface RevokeAgentSessionsSummary {
  agentId?: string;
  revokedCount?: number;
}

export async function revokeAgentActiveSessions(
  agentId: string,
  reason?: string,
): Promise<Arena1IntegrationResult<RevokeAgentSessionsSummary>> {
  const endpoint = `/internal/admin/agents/${encodeURIComponent(agentId)}/sessions/revoke`;
  const trimmedReason = reason?.trim();
  const result = await callArena1Boundary<Record<string, unknown> | null>(
    'POST',
    endpoint,
    'Standalone Agent session invalidation',
    () =>
      trimmedReason
        ? ApiClient.post<Record<string, unknown> | null>(endpoint, { reason: trimmedReason })
        : ApiClient.post<Record<string, unknown> | null>(endpoint),
  );

  if (result.status === 'BLOCKED') return result;

  const raw = result.data && typeof result.data === 'object' ? result.data : {};
  // Arena 1 returns `{ agentId, revokedSessionCount }` (admin-agent-credentials.controller.ts).
  // The earlier alias list omitted that exact spelling, so a successful revocation of N sessions
  // rendered as an unknown count. `revokedSessionCount` is checked first; the aliases are kept as
  // harmless tolerance for older/alternate deployments.
  const countCandidate =
    raw.revokedSessionCount ??
    raw.revokedCount ??
    raw.sessionsInvalidated ??
    raw.revokedSessions ??
    raw.invalidatedCount;
  const revokedCount =
    typeof countCandidate === 'number' && Number.isFinite(countCandidate)
      ? countCandidate
      : undefined;

  return {
    status: 'LIVE',
    data: {
      agentId: typeof raw.agentId === 'string' ? raw.agentId : undefined,
      revokedCount,
    },
  };
}

export interface CashToCashExpiryStatusView {
  recognized: boolean;
  workerEnabled?: boolean;
  dueUnclaimedCount?: number;
  totalUnclaimedCount?: number;
  expiredTotalCount?: number;
  oldestDueExpiresAt?: string | null;
  pollIntervalMs?: number;
  batchSize?: number;
  lastSweepAt?: string | null;
  lastExpiredCount?: number;
  /** This HTTP-serving process only — not fleet-wide worker health. */
  schedulerRunning?: boolean;
  tickInProgress?: boolean;
  /** Database clock used for the snapshot, when the backend supplies it. */
  asOf?: string | null;
}

/** Keys Arena 1 nests inside `worker`; presence of any one proves a recognised shape. */
const EXPIRY_WORKER_NESTED_KEYS = [
  'configuredEnabled',
  'schedulerRunning',
  'tickInProgress',
  'pollIntervalMs',
  'batchSize',
] as const;

const EXPIRY_RECOGNIZED_KEYS = [
  'workerEnabled',
  'enabled',
  'dueUnclaimedCount',
  'dueCount',
  'overdueUnclaimedCount',
  'backlogCount',
  'totalUnclaimedCount',
  'expiredCount',
  'expiredTotalCount',
  'oldestDueExpiresAt',
  'oldestDueAt',
  'pollIntervalMs',
  'batchSize',
  'lastSweepAt',
  'lastRunAt',
  'lastExpiredCount',
] as const;

function optionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function optionalIsoString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

export async function fetchCashToCashExpiryStatus(): Promise<
  Arena1IntegrationResult<CashToCashExpiryStatusView>
> {
  const endpoint = '/internal/admin/cash-to-cash/expiry-status';
  const result = await callArena1Boundary<unknown>(
    'GET',
    endpoint,
    'Cash-to-Cash expiry worker & backlog status',
    () => ApiClient.get<unknown>(endpoint),
  );

  if (result.status === 'BLOCKED') return result;

  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    return { status: 'LIVE', data: { recognized: false } };
  }

  const raw = result.data as Record<string, unknown>;
  // Arena 1 returns worker state NESTED as `worker: { configuredEnabled, schedulerRunning,
  // tickInProgress, pollIntervalMs, batchSize }` (agent-cash-to-cash-expiry-status.controller.ts →
  // worker.getStatus()). The flat-only reader below would therefore report worker state as
  // unknown. Both shapes are accepted; the nested one is authoritative when present.
  const worker =
    raw.worker && typeof raw.worker === 'object' && !Array.isArray(raw.worker)
      ? (raw.worker as Record<string, unknown>)
      : {};

  const recognized =
    EXPIRY_RECOGNIZED_KEYS.some((key) => key in raw) ||
    EXPIRY_WORKER_NESTED_KEYS.some((key) => key in worker) ||
    'worker' in raw;
  if (!recognized) {
    return { status: 'LIVE', data: { recognized: false } };
  }

  const workerEnabled =
    typeof worker.configuredEnabled === 'boolean'
      ? worker.configuredEnabled
      : typeof raw.workerEnabled === 'boolean'
        ? raw.workerEnabled
        : typeof raw.enabled === 'boolean'
          ? raw.enabled
          : undefined;

  return {
    status: 'LIVE',
    data: {
      recognized: true,
      workerEnabled,
      dueUnclaimedCount: optionalFiniteNumber(
        raw.dueUnclaimedCount ?? raw.overdueUnclaimedCount ?? raw.dueCount ?? raw.backlogCount,
      ),
      totalUnclaimedCount: optionalFiniteNumber(raw.totalUnclaimedCount ?? raw.unclaimedCount),
      expiredTotalCount: optionalFiniteNumber(raw.expiredTotalCount ?? raw.expiredCount),
      oldestDueExpiresAt: optionalIsoString(raw.oldestDueExpiresAt ?? raw.oldestDueAt),
      // This-process scheduler/timer booleans, surfaced so the UI can distinguish "disabled by
      // configuration" from "enabled but timer idle". Process-local only — never fleet health.
      schedulerRunning:
        typeof worker.schedulerRunning === 'boolean' ? worker.schedulerRunning : undefined,
      tickInProgress: typeof worker.tickInProgress === 'boolean' ? worker.tickInProgress : undefined,
      pollIntervalMs: optionalFiniteNumber(
        worker.pollIntervalMs ?? raw.pollIntervalMs ?? raw.intervalMs,
      ),
      batchSize: optionalFiniteNumber(worker.batchSize ?? raw.batchSize),
      lastSweepAt: optionalIsoString(raw.lastSweepAt ?? raw.lastRunAt),
      lastExpiredCount: optionalFiniteNumber(raw.lastExpiredCount),
      asOf: optionalIsoString(raw.asOf),
    },
  };
}
