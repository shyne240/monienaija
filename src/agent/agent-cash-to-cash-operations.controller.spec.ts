import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentCashToCashOperationsController } from './agent-cash-to-cash-operations.controller';

const agentId = '11111111-1111-4111-8111-111111111111';
const transferId = '22222222-2222-4222-8222-222222222222';
const principal: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'workforce-operator-1',
  roles: ['FINANCE_AUDITOR'],
  scopes: ['transaction.view'],
  customerAccess: 'NONE',
};

const row = {
  id: transferId,
  agent_id: agentId,
  agent_reference: 'AG-0001',
  beneficiary_phone: '0700000123',
  principal_minor: '123456',
  fee_minor: '0',
  vat_minor: '0',
  total_minor: '123456',
  currency: 'NGN',
  status: 'CLAIMED',
  journal_id: '33333333-3333-4333-8333-333333333333',
  reference: 'C2C-001',
  claimant_customer_id: '44444444-4444-4444-8444-444444444444',
  claim_journal_id: '55555555-5555-4555-8555-555555555555',
  claim_reference: 'CLAIM-001',
  redemption_method: 'AGENT_CASH',
  claimed_at: new Date('2026-10-26T10:10:00.000Z'),
  expires_at: new Date('2026-10-27T10:00:00.000Z'),
  expired_at: null,
  created_at: new Date('2026-10-26T10:00:00.000Z'),
  updated_at: new Date('2026-10-26T10:10:00.000Z'),
};

describe('AgentCashToCashOperationsController', () => {
  let query: jest.Mock;
  let requireFunction: jest.Mock;
  let controller: AgentCashToCashOperationsController;

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      if (sql.includes('count(*)')) return [{ total: '1' }];
      return [row];
    });
    requireFunction = jest.fn().mockResolvedValue(principal.principalId);
    controller = new AgentCashToCashOperationsController(
      { query } as unknown as DataSource,
      { requireFunction } as any,
    );
  });

  test('requires transaction.view and returns only safe, masked, paginated receipt data', async () => {
    const result = await controller.listTransfers(
      { authorizationPrincipal: principal },
      '2',
      '50',
      'claimed',
      agentId,
      transferId,
      'C2C-001',
    );

    expect(requireFunction).toHaveBeenCalledWith(
      principal,
      'transaction.view',
      'agent-cash-to-cash-operations',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    expect(result).toMatchObject({ total: 1, page: 2, limit: 50, totalPages: 1 });
    expect(result.data[0]).toMatchObject({
      id: transferId,
      agentId,
      agentReference: 'AG-0001',
      beneficiaryPhoneMasked: '••••••0123',
      principalMinor: '123456',
      status: 'CLAIMED',
      redemptionMethod: 'AGENT_CASH',
      claimJournalId: row.claim_journal_id,
    });
    expect(result.data[0]).not.toHaveProperty('beneficiaryPhone');
    expect(result.data[0]).not.toHaveProperty('transferCodeHash');
    expect(result.data[0]).not.toHaveProperty('idempotencyKey');
    expect(result.data[0]).not.toHaveProperty('requestHash');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual(['CLAIMED', agentId, transferId, 'C2C-001']);
    expect(query.mock.calls[1][1]).toEqual(['CLAIMED', agentId, transferId, 'C2C-001', 50, 50]);
    expect(query.mock.calls[1][0]).not.toMatch(/transfer_code_hash|idempotency_key|request_hash/i);
  });

  test('rejects malformed filters before querying transfer data', async () => {
    await expect(controller.listTransfers({ authorizationPrincipal: principal }, '1', '20', 'PENDING'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.listTransfers({ authorizationPrincipal: principal }, '1', '20', undefined, 'bad-id'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  test('enforces the authorization decision returned by transaction.view', async () => {
    requireFunction.mockRejectedValue(new ForbiddenException('Authorization denied: FUNCTION_MISSING'));
    await expect(controller.listTransfers({ authorizationPrincipal: principal }))
      .rejects.toThrow('Authorization denied: FUNCTION_MISSING');
    expect(query).not.toHaveBeenCalled();
  });
});
