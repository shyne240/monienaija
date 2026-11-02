import { DataSource } from 'typeorm';

import { ConfigureTransactionNotificationEvents1785753600103 } from '../src/migrations/1785753600103-ConfigureTransactionNotificationEvents';
import { FINANCIAL_NOTIFICATION_EVENT_TYPES, seedNotificationDefaultsV2 } from '../src/notification/notification-defaults-v2';
import { createEmptyIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('H-04/H-06 additive notification controls upgrade (real PostgreSQL)', () => {
  let ds: DataSource;
  let fullChain: Array<new () => unknown>;

  beforeAll(async () => {
    ds = await createEmptyIntegrationDataSource('h0406upgrade');
    await ds.initialize();
    fullChain = ds.migrations.map((migration) => migration.constructor as new () => unknown);
    const historical = ds.migrations
      .filter((migration) => Number(String(migration.name ?? '').slice(-13)) <= 1785753600102)
      .map((migration) => migration.constructor);
    const old = new DataSource({ ...ds.options, migrations: historical });
    await ds.destroy();
    ds = old;
    await ds.initialize();
    await ds.runMigrations({ transaction: 'all' });
  }, 180_000);

  afterAll(async () => {
    if (ds) await destroyIntegrationDataSource(ds);
  }, 60_000);

  it('preserves existing choices and security, audits repaired financial locks, and seeds independent controls once', async () => {
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=false, version=version+1, updated_by='legacy-admin'
      WHERE event_type='transfer.failed' AND channel='SMS'`);
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=true, version=version+1, updated_by='legacy-admin'
      WHERE event_type='transfer.failed' AND channel='EMAIL'`);
    // Preserve even a pre-existing nonstandard, governed template history without a v1 row.
    await ds.query(`INSERT INTO notification_event_configurations
      (event_type,channel,delivery_class,is_enabled,is_locked,version,updated_by)
      VALUES ('deposit.completed','SMS','TRANSACTIONAL',true,false,2,'legacy-admin')`);
    await ds.query(`INSERT INTO notification_templates
      (event_type,channel,locale,version,is_active,subject,body,created_by)
      VALUES ('deposit.completed','SMS','en-NG',2,true,NULL,'Existing safe version.','legacy-admin')`);
    // Simulate a pre-upgrade, incorrectly locked SECURITY classification on a financial row.
    await ds.query(`ALTER TABLE notification_event_configurations DISABLE TRIGGER notification_configuration_guard`);
    await ds.query(`UPDATE notification_event_configurations SET delivery_class='SECURITY', is_locked=true,
      version=version+1, updated_by='legacy-financial-lock' WHERE event_type='transfer.completed' AND channel='SMS'`);
    await ds.query(`ALTER TABLE notification_event_configurations ENABLE TRIGGER notification_configuration_guard`);
    const securityBefore = await ds.query<Array<Record<string, unknown>>>(`SELECT event_type,channel,delivery_class,is_enabled,is_locked,version,updated_by
      FROM notification_event_configurations WHERE event_type='agent.desk.customer_otp' ORDER BY channel`);
    const transferFailedBefore = await ds.query<Array<Record<string, unknown>>>(`SELECT channel,is_enabled,is_locked,version,updated_by
      FROM notification_event_configurations WHERE event_type='transfer.failed' ORDER BY channel`);
    const templatesBefore = await ds.query<Array<Record<string, unknown>>>(`SELECT id,version,is_active,subject,body FROM notification_templates
      WHERE event_type='transfer.completed' ORDER BY channel,version`);

    const upgraded = new DataSource({ ...ds.options, migrations: fullChain as never[] });
    await ds.destroy();
    ds = upgraded;
    await ds.initialize();
    const migrations = await ds.runMigrations({ transaction: 'all' });
    expect(migrations.map((migration) => migration.name)).toEqual(['ConfigureTransactionNotificationEvents1785753600103']);
    expect(await ds.showMigrations()).toBe(false);

    expect(await ds.query(`SELECT event_type,channel,delivery_class,is_enabled,is_locked,version,updated_by
      FROM notification_event_configurations WHERE event_type='agent.desk.customer_otp' ORDER BY channel`)).toEqual(securityBefore);
    expect(await ds.query(`SELECT channel,is_enabled,is_locked,version,updated_by
      FROM notification_event_configurations WHERE event_type='transfer.failed' AND channel <> 'EVENT' ORDER BY channel`)).toEqual(transferFailedBefore);
    expect(await ds.query(`SELECT id,version,is_active,subject,body FROM notification_templates
      WHERE event_type='transfer.completed' ORDER BY channel,version`)).toEqual(templatesBefore);
    expect(await ds.query(`SELECT delivery_class,is_enabled,is_locked,version,updated_by
      FROM notification_event_configurations WHERE event_type='transfer.completed' AND channel='SMS'`)).toEqual([
      { delivery_class: 'TRANSACTIONAL', is_enabled: true, is_locked: false, version: 3, updated_by: 'SYSTEM_MIGRATION_0103' },
    ]);
    const audits = await ds.query<Array<{ previous_values: Record<string, unknown>; new_values: Record<string, unknown> }>>(
      `SELECT previous_values,new_values FROM audit_events WHERE action='NOTIFICATION_FINANCIAL_LOCK_REMOVED'`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.previous_values).toMatchObject({ eventType: 'transfer.completed', channel: 'SMS', deliveryClass: 'SECURITY', locked: true, version: 2 });
    expect(audits[0]?.new_values).toMatchObject({ deliveryClass: 'TRANSACTIONAL', locked: false, version: 3 });
    expect(await ds.query(`SELECT channel,is_enabled FROM notification_event_configurations
      WHERE event_type='transfer.unknown' ORDER BY channel`)).toEqual([
      { channel: 'EMAIL', is_enabled: true }, { channel: 'EVENT', is_enabled: true }, { channel: 'SMS', is_enabled: false },
    ]);
    const configs = await ds.query<Array<{ event_type: string; channel: string; is_locked: boolean }>>(
      `SELECT event_type,channel,is_locked FROM notification_event_configurations WHERE event_type=ANY($1::text[])`,
      [FINANCIAL_NOTIFICATION_EVENT_TYPES],
    );
    expect(configs).toHaveLength(FINANCIAL_NOTIFICATION_EVENT_TYPES.length * 3);
    expect(configs.every((row) => !row.is_locked)).toBe(true);
    expect(await ds.query(`SELECT event_type,channel,is_enabled FROM notification_event_configurations
      WHERE event_type IN ('deposit.completed','deposit.failed','withdrawal.completed','withdrawal.failed') ORDER BY event_type,channel`))
      .toHaveLength(12);
    const paymentEnabled = await ds.query<Array<{ n: number }>>(`SELECT COUNT(*)::int AS n FROM notification_event_configurations
      WHERE event_type IN ('deposit.completed','deposit.failed','withdrawal.completed','withdrawal.failed') AND is_enabled`);
    // The pre-existing SMS choice is untouched, while all new event masters remain dark.
    expect(paymentEnabled[0]?.n).toBe(1);
    expect(await ds.query(`SELECT is_enabled,version,updated_by FROM notification_event_configurations
      WHERE event_type='deposit.completed' AND channel='SMS'`)).toEqual([
      { is_enabled: true, version: 2, updated_by: 'legacy-admin' },
    ]);
    expect(await ds.query(`SELECT version,is_active,body FROM notification_templates
      WHERE event_type='deposit.completed' AND channel='SMS'`)).toEqual([
      { version: 2, is_active: true, body: 'Existing safe version.' },
    ]);
    expect(await ds.query(`SELECT count(*)::int AS n FROM notification_event_configurations
      WHERE event_type IN ('deposit.completed','deposit.failed','withdrawal.completed','withdrawal.failed')
        AND channel='EVENT' AND is_enabled`)).toEqual([{ n: 0 }]);

    await ds.query(`UPDATE notification_event_configurations SET is_enabled=false,version=version+1
      WHERE event_type='transfer.unknown' AND channel='EMAIL'`);
    await seedNotificationDefaultsV2(ds.manager);
    expect(await ds.query(`SELECT is_enabled,version FROM notification_event_configurations
      WHERE event_type='transfer.unknown' AND channel='EMAIL'`)).toEqual([{ is_enabled: false, version: 2 }]);
    expect(await ds.query(`SELECT is_enabled,version FROM notification_event_configurations
      WHERE event_type='transfer.failed' AND channel='EMAIL'`)).toEqual([{ is_enabled: true, version: 2 }]);
    await expect(ds.query(`UPDATE notification_event_configurations SET is_enabled=false,version=version+1
      WHERE event_type='agent.desk.customer_otp' AND channel='SMS'`)).rejects.toThrow('locked');
    await expect(new ConfigureTransactionNotificationEvents1785753600103().down()).rejects.toThrow('Refusing notification event-control rollback');
  });
});
