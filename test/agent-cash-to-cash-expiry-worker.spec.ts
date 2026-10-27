import { CAPABILITY_SEED } from '../src/capability-registry/capability.seed';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentCashToCashExpiryWorker } from '../src/agent/agent-cash-to-cash-expiry-worker.service';
import { AgentCashToCashExpiryService, CashToCashExpiryResult } from '../src/agent/agent-cash-to-cash-expiry.service';
import { validateEnvironment } from '../src/config/environment';

const completed = (): CashToCashExpiryResult => ({ expiredCount: 0, expiredIds: [], executedAt: new Date() });

describe('Cash-to-Cash expiry execution lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  function fixture(enabled = true) {
    const expireDueTransfers = jest.fn<Promise<CashToCashExpiryResult>, [unknown]>().mockResolvedValue(completed());
    const worker = new AgentCashToCashExpiryWorker(
      { expireDueTransfers } as unknown as AgentCashToCashExpiryService,
      new ConfigService({ CASH_TO_CASH_EXPIRY_WORKER_ENABLED: enabled, CASH_TO_CASH_EXPIRY_WORKER_POLL_INTERVAL_MS: 1000 }),
    );
    return { worker, expireDueTransfers };
  }

  it('is disabled by default and starts no timer or work', async () => {
    const { worker, expireDueTransfers } = fixture(false);
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(5000);
    expect(await worker.tick()).toEqual({ status: 'DISABLED', expiredCount: 0 });
    expect(expireDueTransfers).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    await worker.onModuleDestroy();
  });

  it('starts immediately, polls, logs failure without raw errors and recovers next tick', async () => {
    const { worker, expireDueTransfers } = fixture();
    expireDueTransfers.mockRejectedValueOnce(new Error('sensitive driver parameters'));
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(1000);
    expect(expireDueTransfers).toHaveBeenCalledTimes(2);
    expect(expireDueTransfers).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, statementTimeoutMs: 10000, actor: 'system-c2c-expiry-worker' }));
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'c2c_expiry_tick_failed' }));
    expect(JSON.stringify((Logger.prototype.error as jest.Mock).mock.calls)).not.toContain('sensitive driver parameters');
    await worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5000);
    expect(expireDueTransfers).toHaveBeenCalledTimes(2);
  });

  it('skips overlap and waits for active transaction on shutdown', async () => {
    const { worker, expireDueTransfers } = fixture();
    let finish!: (result: CashToCashExpiryResult) => void;
    expireDueTransfers.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const active = worker.tick();
    expect((await worker.tick()).status).toBe('SKIPPED');
    let stopped = false;
    const shutdown = worker.onModuleDestroy().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish(completed());
    await active;
    await shutdown;
    expect((await worker.tick()).status).toBe('DISABLED');
    expect(expireDueTransfers).toHaveBeenCalledTimes(1);
  });

  it('validates bounded worker configuration', () => {
    const env = { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test-password' };
    expect(validateEnvironment(env).CASH_TO_CASH_EXPIRY_WORKER_ENABLED).toBe(false);
    for (const setting of [
      { CASH_TO_CASH_EXPIRY_WORKER_BATCH_SIZE: '0' },
      { CASH_TO_CASH_EXPIRY_WORKER_BATCH_SIZE: '1001' },
      { CASH_TO_CASH_EXPIRY_WORKER_POLL_INTERVAL_MS: '0' },
      { CASH_TO_CASH_EXPIRY_WORKER_STATEMENT_TIMEOUT_MS: '60001' },
      { CASH_TO_CASH_EXPIRY_WORKER_ENABLED: 'yes' },
    ]) expect(() => validateEnvironment({ ...env, ...setting })).toThrow();
  });
  it('describes expiry as an opt-in backend worker, not a refund or an HTTP API', () => {
    const entry = CAPABILITY_SEED.find(item => item.capabilityCode === 'CASH_TO_CASH_EXPIRY');
    expect(entry).toMatchObject({ lifecycle: 'BACKEND_IMPLEMENTED', apiStatus: 'NOT_EXPOSED', configurationStatus: 'NOT_CONFIGURED' });
    expect(entry?.description).toContain('no refund or journal');
  });

});
