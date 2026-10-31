import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentCashToCashExpiryStatusController } from '../src/agent/agent-cash-to-cash-expiry-status.controller';
import { AgentCashToCashExpiryWorker } from '../src/agent/agent-cash-to-cash-expiry-worker.service';

describe('Mission 15A read-only expiry status', () => {
  it('authorizes first and returns aggregates without invoking a sweep', async () => {
    const asOf = new Date('2026-10-30T12:00:00Z');
    const oldest = new Date('2026-10-30T11:00:00Z');
    const query = jest.fn((sql: string) => {
      void sql;
      return Promise.resolve([{ as_of: asOf, due_count: '2', oldest_due_at: oldest, expired_count: '3' }]);
    });
    const requireFunction = jest.fn().mockResolvedValue('operator');
    const workerStatus = { configuredEnabled: false, schedulerRunning: false, tickInProgress: false, pollIntervalMs: 60000, batchSize: 100 };
    const getStatus = jest.fn(() => workerStatus);
    const tick = jest.fn();
    const controller = new AgentCashToCashExpiryStatusController(
      { query } as never, { requireFunction } as never, { getStatus, tick } as never,
    );
    const principal = { type: 'OPERATOR', principalId: 'operator', roles: [], scopes: ['transaction.view'], customerAccess: 'NONE' } as const;
    const result = await controller.status({ authorizationPrincipal: principal });
    expect(requireFunction).toHaveBeenCalledWith(principal, 'transaction.view', 'agent-cash-to-cash-operations', ['OPERATOR', 'SERVICE', 'PRIVILEGED']);
    expect(result).toEqual({ asOf, dueCount: 2, oldestDueAt: oldest, expiredCount: 3, worker: workerStatus });
    expect(query.mock.calls[0]?.[0]).not.toMatch(/UPDATE|INSERT|DELETE|transfer_code|beneficiary_phone/i);
    expect(tick).not.toHaveBeenCalled();
  });

  it('denies without querying any transfer state', async () => {
    const query = jest.fn();
    const controller = new AgentCashToCashExpiryStatusController(
      { query } as never,
      { requireFunction: jest.fn().mockRejectedValue(new ForbiddenException()) } as never,
      { getStatus: jest.fn() } as never,
    );
    await expect(controller.status({})).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('describes only this worker instance and does not mistake configuration for a running scheduler', async () => {
    const config = new ConfigService({ CASH_TO_CASH_EXPIRY_WORKER_ENABLED: true, CASH_TO_CASH_EXPIRY_WORKER_POLL_INTERVAL_MS: 1234 });
    const expiry = { expireDueTransfers: jest.fn().mockResolvedValue({ expiredCount: 0 }) };
    const worker = new AgentCashToCashExpiryWorker(expiry as never, config);
    expect(worker.getStatus()).toEqual({ configuredEnabled: true, schedulerRunning: false, tickInProgress: false, pollIntervalMs: 1234, batchSize: 100 });
    worker.onModuleInit();
    expect(worker.getStatus().schedulerRunning).toBe(true);
    await worker.onModuleDestroy();
    expect(worker.getStatus().schedulerRunning).toBe(false);
  });
});
