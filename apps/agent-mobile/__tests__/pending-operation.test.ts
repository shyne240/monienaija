/**
 * V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-01.
 *
 * Direct unit coverage of apps/agent-mobile/src/services/pending-operation.ts — the
 * SecureStorage-backed record that lets an Agent's Idempotency-Key survive an app-process
 * kill for Cash-In, Cash-Out, and Cash-to-Cash send (the three flows confirmed vulnerable;
 * Cash-to-Cash CLAIM is deliberately excluded — see
 * docs/V1/V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01.md).
 */
import {
  clearAllPendingAgentOperations,
  clearPendingAgentOperation,
  loadPendingAgentOperation,
  matchesPendingAgentOperation,
  savePendingAgentOperation,
  type PendingAgentOperation,
} from '../src/services/pending-operation';
import { SecureStorage } from '../src/services/secure-storage';

function makeIntent(overrides: Partial<PendingAgentOperation> = {}): PendingAgentOperation {
  return {
    agentId: 'agent-A',
    operationType: 'CASH_IN',
    idempotencyKey: 'c2w-key-1',
    counterpartyId: '8000000001',
    amountMinor: '250000',
    currency: 'NGN',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('pending-operation — save/load round trip', () => {
  test('1. a saved operation is loaded back verbatim for its own agent + type', async () => {
    const intent = makeIntent();
    await savePendingAgentOperation(intent);
    const loaded = await loadPendingAgentOperation('agent-A', 'CASH_IN');
    expect(loaded).toEqual(intent);
  });

  test('2. no pending operation returns null, not an error', async () => {
    const loaded = await loadPendingAgentOperation('agent-nobody', 'CASH_IN');
    expect(loaded).toBeNull();
  });

  test('3. clearing an operation removes it (subsequent load returns null)', async () => {
    const intent = makeIntent({ agentId: 'agent-clear-me' });
    await savePendingAgentOperation(intent);
    expect(await loadPendingAgentOperation('agent-clear-me', 'CASH_IN')).not.toBeNull();
    await clearPendingAgentOperation('agent-clear-me', 'CASH_IN');
    expect(await loadPendingAgentOperation('agent-clear-me', 'CASH_IN')).toBeNull();
  });
});

describe('pending-operation — Agent isolation (PART 5/7)', () => {
  test('4. Agent A cannot read Agent B pending operation of the same type', async () => {
    await savePendingAgentOperation(makeIntent({ agentId: 'agent-A-iso', idempotencyKey: 'a-key' }));
    await savePendingAgentOperation(makeIntent({ agentId: 'agent-B-iso', idempotencyKey: 'b-key' }));

    const loadedA = await loadPendingAgentOperation('agent-A-iso', 'CASH_IN');
    const loadedB = await loadPendingAgentOperation('agent-B-iso', 'CASH_IN');
    expect(loadedA?.idempotencyKey).toBe('a-key');
    expect(loadedB?.idempotencyKey).toBe('b-key');

    // Agent A asking for an operation type it never saved never resolves to B's record.
    expect(await loadPendingAgentOperation('agent-A-iso', 'CASH_OUT')).toBeNull();
  });

  test('5. different operation types for the SAME Agent never collide', async () => {
    await savePendingAgentOperation(
      makeIntent({ agentId: 'agent-multi', operationType: 'CASH_IN', idempotencyKey: 'cash-in-key' }),
    );
    await savePendingAgentOperation(
      makeIntent({ agentId: 'agent-multi', operationType: 'CASH_OUT', idempotencyKey: 'cash-out-key' }),
    );
    await savePendingAgentOperation(
      makeIntent({
        agentId: 'agent-multi',
        operationType: 'CASH_TO_CASH_SEND',
        idempotencyKey: 'c2c-send-key',
      }),
    );

    expect((await loadPendingAgentOperation('agent-multi', 'CASH_IN'))?.idempotencyKey).toBe('cash-in-key');
    expect((await loadPendingAgentOperation('agent-multi', 'CASH_OUT'))?.idempotencyKey).toBe('cash-out-key');
    expect((await loadPendingAgentOperation('agent-multi', 'CASH_TO_CASH_SEND'))?.idempotencyKey).toBe(
      'c2c-send-key',
    );

    // Clearing one type leaves the others intact.
    await clearPendingAgentOperation('agent-multi', 'CASH_IN');
    expect(await loadPendingAgentOperation('agent-multi', 'CASH_IN')).toBeNull();
    expect((await loadPendingAgentOperation('agent-multi', 'CASH_OUT'))?.idempotencyKey).toBe('cash-out-key');
    expect((await loadPendingAgentOperation('agent-multi', 'CASH_TO_CASH_SEND'))?.idempotencyKey).toBe(
      'c2c-send-key',
    );
  });

  test('6. a stored record whose own fields disagree with the key it was read from is never trusted', async () => {
    // Defense in depth: write a tampered/corrupted record directly under agent-X's storage key
    // but with a mismatched internal agentId field.
    await SecureStorage.set(
      'pending_agent_operation:agent-X:CASH_IN',
      JSON.stringify(makeIntent({ agentId: 'agent-Y', idempotencyKey: 'should-not-be-trusted' })),
    );
    expect(await loadPendingAgentOperation('agent-X', 'CASH_IN')).toBeNull();
  });
});

describe('pending-operation — staleness window (24h)', () => {
  test('7. a fresh intent (just created) is returned', async () => {
    await savePendingAgentOperation(makeIntent({ agentId: 'agent-fresh', createdAt: new Date().toISOString() }));
    expect(await loadPendingAgentOperation('agent-fresh', 'CASH_IN')).not.toBeNull();
  });

  test('8. an intent older than 24h is treated as abandoned and cleared, not resurrected', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await savePendingAgentOperation(makeIntent({ agentId: 'agent-stale', createdAt: old }));
    expect(await loadPendingAgentOperation('agent-stale', 'CASH_IN')).toBeNull();
    // Staleness also clears the record from storage, not merely ignores it.
    const raw = await SecureStorage.get('pending_agent_operation:agent-stale:CASH_IN');
    expect(raw).toBeNull();
  });

  test('9. a corrupt/unparseable stored value fails closed to null', async () => {
    await SecureStorage.set('pending_agent_operation:agent-corrupt:CASH_IN', 'not-json{{{');
    expect(await loadPendingAgentOperation('agent-corrupt', 'CASH_IN')).toBeNull();
  });
});

describe('pending-operation — matching is exact-field, never fuzzy (PART 6)', () => {
  test('10. identical counterparty + amount + currency matches', () => {
    const intent = makeIntent();
    expect(
      matchesPendingAgentOperation(intent, {
        counterpartyId: '8000000001',
        amountMinor: '250000',
        currency: 'NGN',
      }),
    ).toBe(true);
  });

  test('11. a different counterparty, amount, or currency never matches — no fuzzy attribution', () => {
    const intent = makeIntent();
    expect(
      matchesPendingAgentOperation(intent, { counterpartyId: '8099999999', amountMinor: '250000', currency: 'NGN' }),
    ).toBe(false);
    expect(
      matchesPendingAgentOperation(intent, { counterpartyId: '8000000001', amountMinor: '999999', currency: 'NGN' }),
    ).toBe(false);
    expect(
      matchesPendingAgentOperation(intent, { counterpartyId: '8000000001', amountMinor: '250000', currency: 'USD' }),
    ).toBe(false);
  });
});

describe('pending-operation — logout clears all pending operations for an Agent (PART 7)', () => {
  test('12. clearAllPendingAgentOperations wipes every operation type for that Agent only', async () => {
    await savePendingAgentOperation(makeIntent({ agentId: 'agent-logout', operationType: 'CASH_IN' }));
    await savePendingAgentOperation(makeIntent({ agentId: 'agent-logout', operationType: 'CASH_OUT' }));
    await savePendingAgentOperation(makeIntent({ agentId: 'agent-logout', operationType: 'CASH_TO_CASH_SEND' }));
    await savePendingAgentOperation(makeIntent({ agentId: 'agent-survivor', operationType: 'CASH_IN' }));

    await clearAllPendingAgentOperations('agent-logout');

    expect(await loadPendingAgentOperation('agent-logout', 'CASH_IN')).toBeNull();
    expect(await loadPendingAgentOperation('agent-logout', 'CASH_OUT')).toBeNull();
    expect(await loadPendingAgentOperation('agent-logout', 'CASH_TO_CASH_SEND')).toBeNull();
    // A different Agent's pending state on the same device is never touched.
    expect(await loadPendingAgentOperation('agent-survivor', 'CASH_IN')).not.toBeNull();
  });
});
