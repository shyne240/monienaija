/**
 * Mission 16 integration regression — Arena 1 ↔ Arena 2 response-shape compatibility.
 *
 * These tests exercise the REAL backend response shapes documented in
 * `docs/ordinary-agent-v1/mission-15a-api-contract-20261030.md` and emitted by
 * `src/admin/admin-agent-credentials.controller.ts` and
 * `src/agent/agent-cash-to-cash-expiry-status.controller.ts`.
 *
 * Arena 2's original parsing was written against assumed shapes (`revokedCount`, flat
 * `workerEnabled`), so its own tests passed while the real backend would have rendered an
 * unknown revocation count and an unknown worker state. Both parsers now accept the actual
 * shapes; these assertions lock that in.
 */
import { ApiClient } from '../src/services/api-client';
import {
  fetchCashToCashExpiryStatus,
  revokeAgentActiveSessions,
} from '../src/services/ordinary-agent-admin-api';

jest.mock('../src/services/api-client', () => {
  class MockApiError extends Error {
    constructor(
      public override readonly message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    ApiClient: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    },
    ApiError: MockApiError,
  };
});

const AGENT_ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Mission 16 — session revocation count contract', () => {
  test('reads revokedSessionCount, the field Arena 1 actually returns', async () => {
    // exact shape of POST /internal/admin/agents/:id/sessions/revoke
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({
      agentId: AGENT_ID,
      revokedSessionCount: 2,
    });

    const result = await revokeAgentActiveSessions(AGENT_ID, 'Device lost at desk');

    expect(result.status).toBe('LIVE');
    if (result.status !== 'LIVE') throw new Error('unreachable');
    expect(result.data.revokedCount).toBe(2);
    expect(result.data.agentId).toBe(AGENT_ID);
  });

  test('reports zero revocations truthfully rather than as unknown', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({
      agentId: AGENT_ID,
      revokedSessionCount: 0,
    });

    const result = await revokeAgentActiveSessions(AGENT_ID);

    if (result.status !== 'LIVE') throw new Error('unreachable');
    expect(result.data.revokedCount).toBe(0);
  });

  test('still tolerates the legacy alias spellings', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({
      agentId: AGENT_ID,
      sessionsInvalidated: 3,
    });

    const result = await revokeAgentActiveSessions(AGENT_ID);

    if (result.status !== 'LIVE') throw new Error('unreachable');
    expect(result.data.revokedCount).toBe(3);
  });

  test('does not invent a count when the backend omits it', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({ agentId: AGENT_ID });

    const result = await revokeAgentActiveSessions(AGENT_ID);

    if (result.status !== 'LIVE') throw new Error('unreachable');
    expect(result.data.revokedCount).toBeUndefined();
  });
});

describe('Mission 16 — Cash-to-Cash expiry status contract', () => {
  test('reads the nested worker object Arena 1 actually returns', async () => {
    // exact shape of GET /internal/admin/cash-to-cash/expiry-status
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({
      asOf: '2026-10-30T12:00:00.000Z',
      dueCount: 2,
      oldestDueAt: '2026-10-30T11:00:00.000Z',
      expiredCount: 3,
      worker: {
        configuredEnabled: false,
        schedulerRunning: false,
        tickInProgress: false,
        pollIntervalMs: 60000,
        batchSize: 100,
      },
    });

    const result = await fetchCashToCashExpiryStatus();

    if (result.status !== 'LIVE') throw new Error('unreachable');
    const view = result.data;
    expect(view.recognized).toBe(true);
    // The whole point of read-only monitoring: the operator must see that the worker is OFF.
    expect(view.workerEnabled).toBe(false);
    expect(view.schedulerRunning).toBe(false);
    expect(view.tickInProgress).toBe(false);
    expect(view.dueUnclaimedCount).toBe(2);
    expect(view.expiredTotalCount).toBe(3);
    expect(view.oldestDueExpiresAt).toBe('2026-10-30T11:00:00.000Z');
    expect(view.pollIntervalMs).toBe(60000);
    expect(view.batchSize).toBe(100);
    expect(view.asOf).toBe('2026-10-30T12:00:00.000Z');
  });

  test('nested configuredEnabled=true is surfaced as enabled', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({
      asOf: '2026-10-30T12:00:00.000Z',
      dueCount: 0,
      oldestDueAt: null,
      expiredCount: 0,
      worker: {
        configuredEnabled: true,
        schedulerRunning: true,
        tickInProgress: false,
        pollIntervalMs: 30000,
        batchSize: 50,
      },
    });

    const result = await fetchCashToCashExpiryStatus();

    if (result.status !== 'LIVE') throw new Error('unreachable');
    expect(result.data.workerEnabled).toBe(true);
    expect(result.data.schedulerRunning).toBe(true);
    expect(result.data.pollIntervalMs).toBe(30000);
    expect(result.data.batchSize).toBe(50);
    // null oldest-due is a meaningful "nothing overdue", not an unknown
    expect(result.data.oldestDueExpiresAt).toBeNull();
  });

  test('still tolerates the legacy flat shape', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({
      workerEnabled: true,
      dueUnclaimedCount: 4,
      expiredTotalCount: 1,
      pollIntervalMs: 15000,
      batchSize: 25,
    });

    const result = await fetchCashToCashExpiryStatus();

    if (result.status !== 'LIVE') throw new Error('unreachable');
    expect(result.data.workerEnabled).toBe(true);
    expect(result.data.dueUnclaimedCount).toBe(4);
    expect(result.data.expiredTotalCount).toBe(1);
    expect(result.data.pollIntervalMs).toBe(15000);
    expect(result.data.batchSize).toBe(25);
  });

  test('marks an unrecognised payload instead of fabricating metrics', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({ somethingElse: true });

    const result = await fetchCashToCashExpiryStatus();

    if (result.status !== 'LIVE') throw new Error('unreachable');
    expect(result.data.recognized).toBe(false);
    expect(result.data.dueUnclaimedCount).toBeUndefined();
    expect(result.data.workerEnabled).toBeUndefined();
  });
});
