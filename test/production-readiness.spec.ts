import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { validateEnvironment } from '../src/config/environment';
import { GlobalExceptionFilter } from '../src/http-exception.filter';
import { createRequestContext } from '../src/production/request-context';
import { ApiVersionService } from '../src/production/api-version.service';
import { ProductionConfigurationService } from '../src/production/production-configuration.service';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
import { RequestTrackerService } from '../src/production/request-tracker.service';

class ReadinessDataSource {
  constructor(readonly compatible: boolean) {}

  query(sql: string): Promise<unknown[]> {
    if (sql === 'SELECT 1') {
      return Promise.resolve([{ '?column?': 1 }]);
    }
    if (sql.includes('LIMIT 1')) {
      return Promise.resolve([
        {
          timestamp: this.compatible ? '1785753600016' : '1785753600004',
          name: this.compatible
            ? 'CreateCustomerComplianceCases1785753600016'
            : 'RepairM6UuidDefaults1785753600004',
        },
      ]);
    }
    if (sql.includes('applied_count')) {
      return Promise.resolve([{ applied_count: '17' }]);
    }
    if (sql.includes('pending_count')) {
      return Promise.resolve([{ pending_count: '0' }]);
    }
    return Promise.resolve([]);
  }
}

class ReconciliationStub {
  constructor(private readonly status: 'PASS' | 'WARNING' | 'ERROR' = 'PASS') {}

  runReconciliation(): Promise<{ status: 'PASS' | 'WARNING' | 'ERROR' }> {
    return Promise.resolve({ status: this.status });
  }
}

describe('M8 production readiness', () => {
  it('accepts the expected migration head and rejects an incompatible schema', async () => {
    const compatible = new ProductionReadinessService(
      new ReadinessDataSource(true) as unknown as DataSource,
      new ReconciliationStub() as never,
    );
    await expect(compatible.verifyStartup()).resolves.toBeUndefined();
    await expect(compatible.getReadiness()).resolves.toMatchObject({
      status: 'ok',
      migrations: { compatible: true },
    });

    const warning = new ProductionReadinessService(
      new ReadinessDataSource(true) as unknown as DataSource,
      new ReconciliationStub('WARNING') as never,
    );
    await expect(warning.verifyStartup()).resolves.toBeUndefined();
    await expect(warning.getReadiness()).resolves.toMatchObject({
      status: 'ok',
      reconciliation: { status: 'WARNING' },
    });

    const reconciliationError = new ProductionReadinessService(
      new ReadinessDataSource(true) as unknown as DataSource,
      new ReconciliationStub('ERROR') as never,
    );
    await expect(reconciliationError.verifyStartup()).rejects.toThrow('reconciliation_not_ready');

    const incompatible = new ProductionReadinessService(
      new ReadinessDataSource(false) as unknown as DataSource,
      new ReconciliationStub() as never,
    );
    await expect(incompatible.verifyStartup()).rejects.toThrow('schema_incompatible');
  });

  it('tracks request draining and waits for active requests', async () => {
    const tracker = new RequestTrackerService();
    expect(tracker.start()).toBe(true);
    tracker.beginDrain();
    expect(tracker.start()).toBe(false);
    tracker.finish();
    await expect(tracker.waitForDrain(100)).resolves.toBe(true);
    expect(tracker.activeCount()).toBe(0);
  });

  it('generates safe version and configuration metadata', () => {
    const config = {
      get: (key: string) =>
        ({
          API_VERSION: 'v1',
          APP_VERSION: '1.0.0',
          NODE_ENV: 'staging',
          PORT: 3000,
          LOG_LEVEL: 'info',
          DB_SSL: true,
          IDEMPOTENCY_RETENTION_SECONDS: 86400,
          OUTBOX_RETRY_DELAY_SECONDS: 60,
          SHUTDOWN_DRAIN_TIMEOUT_SECONDS: 30,
        })[key],
    };
    expect(new ApiVersionService(config as never).getVersionMetadata()).toMatchObject({
      current: 'v1',
      supported: ['v1'],
    });
    expect(
      new ProductionConfigurationService(config as never).getSafeConfiguration(),
    ).toMatchObject({
      environment: 'staging',
      version: '1.0.0',
      databaseSsl: true,
    });
  });

  it('validates staging profiles and rejects invalid production configuration', () => {
    const valid = validateEnvironment({
      NODE_ENV: 'staging',
      DB_HOST: 'db',
      DB_NAME: 'monienaija',
      DB_USER: 'monienaija',
      DB_PASSWORD: 'secret',
    });
    expect(valid.NODE_ENV).toBe('staging');
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        PORT: '70000',
        DB_HOST: 'db',
        DB_NAME: 'monienaija',
        DB_USER: 'monienaija',
        DB_PASSWORD: 'secret',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('propagates request, correlation, and trace context', () => {
    const context = createRequestContext({
      'x-request-id': 'request-1',
      'x-correlation-id': 'correlation-1',
      'x-trace-id': 'trace-1',
    });
    expect(context).toEqual({
      requestId: 'request-1',
      correlationId: 'correlation-1',
      traceId: 'trace-1',
    });
  });

  it('standardizes validation errors with a stable code and context', () => {
    const send = jest.fn();
    const response = {
      header: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send,
    };
    const request = {
      id: 'request-1',
      url: '/api/v1/example',
      headers: {
        'x-correlation-id': 'correlation-1',
        'x-trace-id': 'trace-1',
      },
      requestContext: {
        requestId: 'request-1',
        correlationId: 'correlation-1',
        traceId: 'trace-1',
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    new GlobalExceptionFilter(logger).catch(
      new BadRequestException({ message: ['field is invalid'], error: 'Bad Request' }),
      host as never,
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        requestId: 'request-1',
        correlationId: 'correlation-1',
        traceId: 'trace-1',
      }),
    );
  });

  it('keeps business errors distinguishable from conflict errors', () => {
    expect(new ConflictException().getStatus()).toBe(409);
  });
});
