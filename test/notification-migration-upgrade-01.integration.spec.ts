import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';
import { AddEmailNotificationChannel1785753600097 } from '../src/migrations/1785753600097-AddEmailNotificationChannel';
import { CreateNotificationTemplateRegistry1785753600098 } from '../src/migrations/1785753600098-CreateNotificationTemplateRegistry';
import { AllowPhoneNotificationRecipients1785753600099 } from '../src/migrations/1785753600099-AllowPhoneNotificationRecipients';

/**
 * ARENA 3 INTEGRATION (Phase 2) — upgrade-from-baseline on real PostgreSQL.
 *
 * The mission baseline (5206d8f) shipped migration head 1785753600096-CreateCashToCashLocators.
 * This suite builds that exact historical schema, seeds pre-upgrade SMS/PUSH delivery
 * evidence, then applies the three integrated notification migrations (097 EMAIL channel,
 * 098 template registry, 099 PHONE recipients) through the normal TypeORM chain and proves:
 * - only the three new migrations execute (no rewriting of applied history);
 * - pre-existing SMS/PUSH rows survive byte-identical (recipient_id widened losslessly);
 * - EMAIL/PHONE capabilities become available exactly after the upgrade;
 * - the registry seeds from the migration itself (configs 23 events x 2 channels, EMAIL
 *   disabled by default, SECURITY rows locked; 20 defaults x 2 channel template versions);
 * - every down() refuses to destroy delivery evidence or governed registry state
 *   (097 while EMAIL rows exist, 098 when governed changes exist, 099 while PHONE rows
 *   exist), and 099 round-trips safely when no PHONE rows exist.
 */

const BASELINE_HEAD = 'CreateCashToCashLocators1785753600096';
const BASELINE_TIMESTAMP = 1785753600096;

describe('NOTIFICATION-MIGRATION-UPGRADE-01 baseline upgrade (real PostgreSQL)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createEmptyIntegrationDataSource('notifupgrade');
    await dataSource.initialize();
  }, 120_000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  it('1. baseline schema (head 096) rejects EMAIL/PHONE and preserves legacy delivery evidence across the upgrade', async () => {
    const fullChain = [...dataSource.migrations];
    const scopedChain = fullChain.filter(
      (migration) => Number(String(migration.name ?? '').slice(-13)) <= BASELINE_TIMESTAMP,
    );
    expect(
      Math.max(...scopedChain.map((migration) => Number(String(migration.name ?? '').slice(-13)))),
    ).toBe(BASELINE_TIMESTAMP);

    // Build the historical schema exactly as the baseline shipped it.
    const historicalMigrations = scopedChain.map((migration) => migration.constructor);
    const historical = new DataSource({ ...dataSource.options, migrations: historicalMigrations });
    await dataSource.destroy();
    dataSource = historical;
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'all' });
    const head: Array<{ name: string }> = await dataSource.query(
      `SELECT name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`,
    );
    expect(head).toEqual([{ name: BASELINE_HEAD }]);

    // Pre-upgrade delivery evidence (SMS + PUSH, CUSTOMER/AGENT uuid recipients).
    const customerId = randomUUID();
    const agentId = randomUUID();
    const smsKey = `transfer.completed:${randomUUID()}`;
    const pushKey = `customer.funding.approved:${randomUUID()}`;
    await dataSource.query(
      `INSERT INTO notification_deliveries
         (event_type, event_key, recipient_type, recipient_id, channel, destination, payload, message, status, attempts, provider_ref)
       VALUES
         ('transfer.completed',$1,'CUSTOMER',$2,'SMS','08012345678','{}','Transfer of NGN 250.00 completed.','SENT',1,'sms-ref-legacy'),
         ('customer.funding.approved',$3,'AGENT',$4,'PUSH','device-token','{}','Funding approved.','FAILED',2,NULL)`,
      [smsKey, customerId, pushKey, agentId],
    );

    // Baseline posture: EMAIL channel and PHONE recipient type are rejected.
    await expect(
      dataSource.query(
        `INSERT INTO notification_deliveries
           (event_type, event_key, recipient_type, recipient_id, channel, destination, payload, status)
         VALUES ('transfer.completed',$1,'CUSTOMER',$2,'EMAIL','a@b.c','{}','PENDING')`,
        [`transfer.completed:${randomUUID()}`, customerId],
      ),
    ).rejects.toThrow();
    await expect(
      dataSource.query(
        `INSERT INTO notification_deliveries
           (event_type, event_key, recipient_type, recipient_id, channel, destination, payload, status)
         VALUES ('cash_to_cash.created',$1,'PHONE',$2,'SMS','08099999999','{}','PENDING')`,
        [`cash_to_cash.created:${randomUUID()}`, customerId],
      ),
    ).rejects.toThrow();
    // And the registry tables do not exist yet.
    const registryBefore: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('notification_templates','notification_event_configurations','notification_change_requests')`,
    );
    expect(registryBefore).toEqual([]);

    // ---- UPGRADE: normal TypeORM chain against the already-migrated database ----
    const upgraded = new DataSource({ ...dataSource.options, migrations: fullChain.map((m) => m.constructor) });
    await dataSource.destroy();
    dataSource = upgraded;
    await dataSource.initialize();
    const executed = await dataSource.runMigrations({ transaction: 'all' });
    expect(executed.map((m) => m.name)).toEqual([
      'AddEmailNotificationChannel1785753600097',
      'CreateNotificationTemplateRegistry1785753600098',
      'AllowPhoneNotificationRecipients1785753600099',
    ]);
    expect(await dataSource.showMigrations()).toBe(false);

    // Legacy evidence survived byte-identical (recipient_id widened uuid -> varchar losslessly).
    const legacy: Array<{ channel: string; status: string; recipient_id: string; provider_ref: string | null; message: string | null }> =
      await dataSource.query(
        `SELECT channel, status, recipient_id::text AS recipient_id, provider_ref, message
           FROM notification_deliveries ORDER BY channel DESC`,
      );
    expect(legacy).toEqual([
      { channel: 'SMS', status: 'SENT', recipient_id: customerId, provider_ref: 'sms-ref-legacy', message: 'Transfer of NGN 250.00 completed.' },
      { channel: 'PUSH', status: 'FAILED', recipient_id: agentId, provider_ref: null, message: 'Funding approved.' },
    ]);

    // EMAIL + PHONE now accepted.
    await dataSource.query(
      `INSERT INTO notification_deliveries
         (event_type, event_key, recipient_type, recipient_id, channel, destination, payload, status)
       VALUES
         ('transfer.completed',$1,'CUSTOMER',$2,'EMAIL','a@b.c','{}','PENDING'),
         ('cash_to_cash.created',$3,'PHONE','08099999999','SMS','08099999999','{}','PENDING')`,
      [`transfer.completed:${randomUUID()}`, customerId, `cash_to_cash.created:${randomUUID()}`],
    );

    // Registry seeded by migration 098 during the real upgrade run.
    const counts: Array<{ configs: string; sms_enabled: string; email_enabled: string; locked_security: string; templates: string; active_templates: string }> =
      await dataSource.query(`
        SELECT
          (SELECT count(*)::text FROM notification_event_configurations) AS configs,
          (SELECT count(*)::text FROM notification_event_configurations WHERE channel='SMS' AND is_enabled) AS sms_enabled,
          (SELECT count(*)::text FROM notification_event_configurations WHERE channel='EMAIL' AND is_enabled) AS email_enabled,
          (SELECT count(*)::text FROM notification_event_configurations WHERE delivery_class='SECURITY' AND is_locked) AS locked_security,
          (SELECT count(*)::text FROM notification_templates) AS templates,
          (SELECT count(*)::text FROM notification_templates WHERE is_active AND version=1) AS active_templates
      `);
    // 20 transactional defaults + 3 SECURITY config-only events, both channels; SMS enabled
    // for all 23 (SECURITY rows deliver SMS directly, locked against ordinary edits); EMAIL
    // dark by default; 20 defaults x 2 channels = 40 active v1 templates (SECURITY has none).
    expect(counts[0]).toEqual({
      configs: '46',
      sms_enabled: '23',
      email_enabled: '0',
      locked_security: '6',
      templates: '40',
      active_templates: '40',
    });
  }, 240_000);

  it('2. rollback safety — every down() refuses to destroy delivery evidence or governed registry state; 099 round-trips when clean', async () => {
    async function inTransaction(step: (runner: QueryRunner) => Promise<void>): Promise<void> {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await step(runner);
        await runner.commitTransaction();
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    }

    // 097 down refuses while EMAIL delivery rows exist (rows inserted by test 1 persist).
    await expect(
      inTransaction(async (runner) => {
        await new AddEmailNotificationChannel1785753600097().down(runner);
      }),
    ).rejects.toThrow(/EMAIL delivery rows exist/);

    // 099 down refuses while PHONE delivery rows exist.
    await expect(
      inTransaction(async (runner) => {
        await new AllowPhoneNotificationRecipients1785753600099().down(runner);
      }),
    ).rejects.toThrow(/phone deliveries exist/);

    // 098 down refuses once governed change history exists (version bumps are the governed
    // marker; direct activation flips are trigger-restricted).
    await expect(
      inTransaction(async (runner) => {
        await runner.query(
          `UPDATE notification_event_configurations SET is_enabled=false, version=version+1, updated_at=now()
            WHERE event_type='transfer.completed' AND channel='EMAIL'`,
        );
        await new CreateNotificationTemplateRegistry1785753600098().down(runner);
      }),
    ).rejects.toThrow(/governed changes/);

    // With no PHONE rows, 099 round-trips: down narrows recipient_id back to uuid
    // (legacy + EMAIL rows cast cleanly), up widens it again — PHONE accepted afterwards.
    await inTransaction(async (runner) => {
      await runner.query(`DELETE FROM notification_deliveries WHERE recipient_type='PHONE'`);
      await new AllowPhoneNotificationRecipients1785753600099().down(runner);
      const narrow = (await runner.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_name='notification_deliveries' AND column_name='recipient_id'`,
      )) as Array<{ data_type: string }>;
      expect(narrow).toEqual([{ data_type: 'uuid' }]);
      await new AllowPhoneNotificationRecipients1785753600099().up(runner);
      const wide = (await runner.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_name='notification_deliveries' AND column_name='recipient_id'`,
      )) as Array<{ data_type: string }>;
      expect(wide).toEqual([{ data_type: 'character varying' }]);
      await runner.query(
        `INSERT INTO notification_deliveries
           (event_type, event_key, recipient_type, recipient_id, channel, destination, payload, status)
         VALUES ('cash_to_cash.created',$1,'PHONE','08099999998','SMS','08099999998','{}','PENDING')`,
        [`cash_to_cash.created:${randomUUID()}`],
      );
    });
  }, 120_000);
});
