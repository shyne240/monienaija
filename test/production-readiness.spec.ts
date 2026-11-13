import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { validateEnvironment } from '../src/config/environment';
import { GlobalExceptionFilter } from '../src/http-exception.filter';
import { createRequestContext } from '../src/production/request-context';
import { ApiVersionService } from '../src/production/api-version.service';
import { ProductionConfigurationService } from '../src/production/production-configuration.service';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
import { RequestTrackerService } from '../src/production/request-tracker.service';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

interface MigrationHead {
  timestamp: string;
  name: string;
}

/**
 * Derives the migration head from the repository itself instead of hardcoding it, so this test
 * keeps asserting the intended contract (the deployed head of this repository is accepted) without
 * needing a manual edit for every new migration. The production check is unchanged: anything other
 * than the newest repository migration is still rejected, which the incompatible case below proves.
 *
 * TypeORM stores the class name, and this repository names migration classes
 * `<Name><Timestamp>` for files `<Timestamp>-<Name>.ts`.
 */
function repositoryMigrations(): MigrationHead[] {
  return readdirSync(join(__dirname, '..', 'src', 'migrations'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const base = file.replace(/\.ts$/, '');
      const separator = base.indexOf('-');
      const timestamp = base.slice(0, separator);
      const name = base.slice(separator + 1);
      return { timestamp, name: `${name}${timestamp}` };
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

const migrationHead = repositoryMigrations().at(-1)!;
const previousMigrationHead = repositoryMigrations().at(-2)!;

class ReadinessDataSource {
  /** The application's loaded migration classes (none in the generic stub). */
  readonly migrations: Array<{ name: string }> = [];

  constructor(readonly head: MigrationHead = migrationHead) {}

  query(sql: string): Promise<unknown[]> {
    if (sql === 'SELECT 1') {
      return Promise.resolve([{ '?column?': 1 }]);
    }
    if (sql.includes('AS unsafe')) {
      return Promise.resolve([{ unsafe: false }]);
    }
    if (sql.includes('LIMIT 1') || sql.includes('ORDER BY timestamp ASC')) {
      return Promise.resolve([{ timestamp: this.head.timestamp, name: this.head.name }]);
    }
    if (sql.includes('applied_count')) {
      return Promise.resolve([{ applied_count: '18' }]);
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
    // INTEGRATION NOTE (integration/main-backend-frontend-20261030): main pinned this to
    // 'CreateA2WorkforceAuthenticationTables1785753600052', which was main's own chain head.
    // The integrated chain continues to 1785753600101, so a hardcoded head name is exactly the
    // rot this file's repository-derived mechanism exists to avoid. The contract is asserted
    // instead: the chain is complete, strictly ordered and unique, the derived head really is the
    // newest migration in src/migrations, and the customer proof-of-address migrations are present.
    const repositoryHeads = repositoryMigrations();
    expect(repositoryHeads.length).toBeGreaterThan(1);
    expect(migrationHead).toEqual(repositoryHeads[repositoryHeads.length - 1]);
    expect(previousMigrationHead).toEqual(repositoryHeads[repositoryHeads.length - 2]!);
    expect(new Set(repositoryHeads.map((entry) => entry.timestamp)).size).toBe(
      repositoryHeads.length,
    );
    expect(
      repositoryHeads.every(
        (entry, index) => index === 0 || repositoryHeads[index - 1]!.timestamp < entry.timestamp,
      ),
    ).toBe(true);
    expect(repositoryHeads.map((entry) => entry.timestamp)).toEqual(
      expect.arrayContaining(['1785753600093', '1785753600094']),
    );

    const compatible = new ProductionReadinessService(
      new ReadinessDataSource() as unknown as DataSource,
      new ReconciliationStub() as never,
    );
    await expect(compatible.verifyStartup()).resolves.toBeUndefined();
    await expect(compatible.getReadiness()).resolves.toMatchObject({
      status: 'ok',
      migrations: { compatible: true },
    });

    const warning = new ProductionReadinessService(
      new ReadinessDataSource() as unknown as DataSource,
      new ReconciliationStub('WARNING') as never,
    );
    await expect(warning.verifyStartup()).resolves.toBeUndefined();
    await expect(warning.getReadiness()).resolves.toMatchObject({
      status: 'ok',
      reconciliation: { status: 'WARNING' },
    });

    const reconciliationError = new ProductionReadinessService(
      new ReadinessDataSource() as unknown as DataSource,
      new ReconciliationStub('ERROR') as never,
    );
    await expect(reconciliationError.verifyStartup()).rejects.toThrow('reconciliation_not_ready');

    const incompatible = new ProductionReadinessService(
      new ReadinessDataSource(previousMigrationHead) as unknown as DataSource,
      new ReconciliationStub() as never,
    );
    await expect(incompatible.verifyStartup()).rejects.toThrow('schema_incompatible');
  });

  it('fails production readiness closed without a separate protected checker authority', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const readiness = new ProductionReadinessService(
        new ReadinessDataSource() as unknown as DataSource,
        new ReconciliationStub() as never,
      );
      await expect(readiness.getReadiness()).resolves.toMatchObject({
        status: 'error',
        reason: 'protected_checker_authority_not_configured',
        protectedCheckerAuthority: { status: 'not_configured' },
      });
      await expect(readiness.verifyStartup()).rejects.toThrow(
        'protected_checker_authority_not_configured',
      );
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('accepts only a verified protected checker authority in production', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const authority = (status: 'verified' | 'unsafe' | 'unavailable') =>
      ({
        inspect: () =>
          Promise.resolve({
            status,
            checks: {},
            observed: {
              runtimeLoginRole: 'runtime',
              authorityLoginRole: 'authority',
              authorityActiveRole: 'authority',
            },
          }),
      }) as never;
    try {
      const verified = new ProductionReadinessService(
        new ReadinessDataSource() as unknown as DataSource,
        new ReconciliationStub() as never,
        authority('verified'),
      );
      await expect(verified.getReadiness()).resolves.toMatchObject({
        status: 'ok',
        reason: null,
        protectedCheckerAuthority: { status: 'verified' },
      });
      await expect(verified.verifyStartup()).resolves.toBeUndefined();

      const unsafe = new ProductionReadinessService(
        new ReadinessDataSource() as unknown as DataSource,
        new ReconciliationStub() as never,
        authority('unsafe'),
      );
      await expect(unsafe.getReadiness()).resolves.toMatchObject({
        status: 'error',
        reason: 'protected_checker_authority_unsafe',
      });
      await expect(unsafe.verifyStartup()).rejects.toThrow('protected_checker_authority_unsafe');
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('rejects a database that skipped an earlier shipped migration', async () => {
    class MissingEarlierMigration extends ReadinessDataSource {
      override readonly migrations = [
        { name: 'CreateInstitutionFoundation1785753600400' },
        { name: 'CreateInstitutionalFinancialOwnership1785753600401' },
        { name: 'InstitutionGovernanceExecutionIntegrity1785753600500' },
        { name: 'ProtectedAuthorityBoundary1785753600501' },
        { name: 'ProtectedAuthorityInstitutionalOwnership1785753600502' },
      ];
      override query(sql: string): Promise<unknown[]> {
        if (sql.includes('ORDER BY timestamp ASC')) {
          return Promise.resolve([
            { timestamp: '1785753600400', name: 'CreateInstitutionFoundation1785753600400' },
            {
              timestamp: '1785753600501',
              name: 'ProtectedAuthorityBoundary1785753600501',
            },
            {
              timestamp: '1785753600502',
              name: 'ProtectedAuthorityInstitutionalOwnership1785753600502',
            },
          ]);
        }
        return super.query(sql);
      }
    }
    const readiness = new ProductionReadinessService(
      new MissingEarlierMigration() as unknown as DataSource,
      new ReconciliationStub() as never,
    );
    const result = await readiness.getReadiness();
    expect(result.status).toBe('error');
    expect(result.reason).toBe('schema_incompatible');
    expect(result.migrations.compatible).toBe(false);
    expect(result.migrations.missing).toEqual(
      expect.arrayContaining([
        'CreateInstitutionalFinancialOwnership1785753600401',
        'InstitutionGovernanceExecutionIntegrity1785753600500',
      ]),
    );
  });

  it('rejects an applied migration the application does not ship', async () => {
    class UnexpectedMigration extends ReadinessDataSource {
      override readonly migrations = [
        { name: 'ProtectedAuthorityInstitutionalOwnership1785753600502' },
        { name: 'CreateInstitutionFoundation1785753600400' },
      ];
      override query(sql: string): Promise<unknown[]> {
        if (sql.includes('ORDER BY timestamp ASC')) {
          return Promise.resolve([
            { timestamp: '1785753600400', name: 'CreateInstitutionFoundation1785753600400' },
            {
              timestamp: '1785753600401',
              name: 'CreateGovernedLedgerReversalExecutions1785753600117',
            },
            {
              timestamp: '1785753600502',
              name: 'ProtectedAuthorityInstitutionalOwnership1785753600502',
            },
          ]);
        }
        return super.query(sql);
      }
    }
    const readiness = new ProductionReadinessService(
      new UnexpectedMigration() as unknown as DataSource,
      new ReconciliationStub() as never,
    );
    await expect(readiness.getReadiness()).resolves.toMatchObject({
      status: 'error',
      reason: 'schema_incompatible',
      migrations: {
        unexpected: ['CreateGovernedLedgerReversalExecutions1785753600117'],
      },
    });
  });

  it('fails production readiness closed if database role inspection cannot complete', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      class NoRoleInspection extends ReadinessDataSource {
        override query(sql: string): Promise<unknown[]> {
          if (sql.includes('AS unsafe')) return Promise.reject(new Error('inspection unavailable'));
          return super.query(sql);
        }
      }
      const readiness = new ProductionReadinessService(
        new NoRoleInspection() as unknown as DataSource,
        new ReconciliationStub() as never,
      );
      await expect(readiness.getReadiness()).resolves.toMatchObject({
        status: 'error',
        reason: 'runtime_database_role_unsafe',
        runtimeDatabaseRole: { status: 'unavailable' },
      });
    } finally {
      process.env.NODE_ENV = original;
    }
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
