/**
 * ARENA 6 — the backend a real browser is driven against, started outside the test runner.
 *
 * Why this exists: the shipped `dist/main.js` refuses to listen while `verifyStartup()` holds
 * (`financial_dependencies_not_ready`), and that refusal is asserted rather than bypassed everywhere in
 * this repository — including in this script, which prints whether it still fires. The one thing the test
 * harnesses cannot provide is a browser leg: a server created inside a jest worker answers the worker's own
 * requests, but requests that arrive from another process are never flushed back, so every earlier
 * "browser" run stalled at sign-in and produced nothing but a stack trace. So the browser phase gets its
 * own process: the real `AppModule`, the real `AuthorizationService`, the real session store, on the same
 * disposable PostgreSQL the integration suites use.
 *
 * It also writes the row set the drill-down boundary is judged on: three FAILED deliveries in a two-hour
 * window — one at `from`, one a second before `to`, one stamped exactly at `to`. The dashboard card counts
 * the half-open interval and finds two; an ordinary queue query with the inclusive bound finds three. That
 * difference is the whole product decision, and it is observable in the browser rather than only in SQL.
 *
 * Not certified here: nothing. This process never touches a non-loopback interface, and the database is
 * created, migrated and dropped by `test/support/pg-harness.ts` for this run alone.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { DashboardSeedService } from '../src/dashboard/dashboard-seed.service';
import { AuditService } from '../src/operations/audit.service';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from '../test/support/pg-harness';

const load = createRequire(__filename);

interface Json {
  [key: string]: unknown;
}

async function main(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.NOTIFICATION_WORKER_ENABLED = 'false';
  process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
  process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';

  const dataSource = await createIntegrationDataSource('arena6standalone');
  const { AppModule } = await import('../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  await app.init();
  await (app as never as { getHttpAdapter(): { getInstance(): { ready(): Promise<void> } } })
    .getHttpAdapter()
    .getInstance()
    .ready();
  // Port 0 by default: two runs must not collide over a fixed port, and the loopback interface means
  // nothing outside this machine can reach the result anyway.
  const requestedPort = Number(process.env.ARENA6_LIVE_PORT ?? 0);
  await app.listen({ port: requestedPort, host: '127.0.0.1' });
  const address = app.getHttpServer().address() as AddressInfo;

  await truncateAllTables(dataSource);
  await moduleRef.get(DashboardSeedService).seedIfEmpty();
  const seed = load('../scripts/local-dev-seed-11-roles.js') as {
    seedLocalRoles(
      ds: DataSource,
      config: { enabled: boolean; oidcIssuer?: string },
      audit: AuditService,
    ): Promise<unknown[]>;
  };
  const seeded = await seed.seedLocalRoles(
    dataSource,
    moduleRef.get(A2_WORKFORCE_CONFIG) as { enabled: boolean; oidcIssuer?: string },
    moduleRef.get(AuditService),
  );
  let refuses = false;
  try {
    await moduleRef.get(ProductionReadinessService).verifyStartup();
  } catch {
    refuses = true;
  }
  // A window with rows at both edges, so the card and the drill-down can be compared on the same
  // interval: one delivery at `from`, one a second before `to`, one stamped exactly at `to`.
  const { randomUUID } = await import('node:crypto');
  // Whole-minute edges: the console's `Created to` field is a minute-granularity datetime input, and a
  // second-precision bound would be rounded out from under the comparison the browser leg is making.
  const to = new Date(Math.ceil((Date.now() - 60 * 60 * 1000) / 60_000) * 60_000);
  const from = new Date(to.getTime() - 2 * 60 * 60 * 1000);
  const correlationId = `arena6-standalone-${randomUUID()}`;
  const edges = [
    { label: 'exactly at from', at: from },
    { label: 'just before to', at: new Date(to.getTime() - 1000) },
    { label: 'exactly at to', at: to },
  ];
  for (const edge of edges) {
    await dataSource.query(
      `INSERT INTO notification_deliveries
         (id, event_type, event_key, recipient_type, recipient_id, channel, destination, payload,
          status, attempts, correlation_id, created_at, updated_at, failed_at)
       VALUES ($1,$2,$3,'CUSTOMER',$4,'SMS',$5,$6::jsonb,'FAILED',1,$7,$8,$8,$8)`,
      [
        randomUUID(),
        'transfer.failed',
        `transfer.failed:arena6-edge:${correlationId}:${edge.label}`,
        randomUUID(),
        '+2348000000000',
        JSON.stringify({ synthetic: true, edge: edge.label }),
        correlationId,
        edge.at,
      ],
    );
  }
  process.stdout.write(
    `STANDALONE_READY ${JSON.stringify({ port: address.port, seeded: seeded.length, readinessRefuses: refuses, correlationId, window: { from: from.toISOString(), to: to.toISOString() } })}\n`,
  );
  process.on('SIGTERM', () => {
    void (async () => {
      await app.close();
      await destroyIntegrationDataSource(dataSource);
      process.exit(0);
    })();
  });
  // keep alive
  setInterval(() => undefined, 60_000);
}

main().catch((error) => {
  process.stderr.write(`STANDALONE_FAILED ${String(error)}\n`);
  process.exit(1);
});
