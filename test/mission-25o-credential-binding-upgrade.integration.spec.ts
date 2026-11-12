import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AddNotificationCredentialBinding1785753600102 } from '../src/migrations/1785753600102-AddNotificationCredentialBinding';
import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';

describe('M25O additive 101-to-102 upgrade (isolated real PostgreSQL)', () => {
  let ds: DataSource;
  let allMigrations: Array<new () => unknown>;
  const proposalId = randomUUID();
  const approvalId = randomUUID();

  beforeAll(async () => {
    ds = await createEmptyIntegrationDataSource('m25oupgrade');
    await ds.initialize();
    allMigrations = ds.migrations.map((m) => m.constructor as new () => unknown);
    const previous = ds.migrations
      .filter((m) => Number(String(m.name ?? '').slice(-13)) <= 1785753600101)
      .map((m) => m.constructor);
    const historical = new DataSource({ ...ds.options, migrations: previous });
    await ds.destroy();
    ds = historical;
    await ds.initialize();
    await ds.runMigrations({ transaction: 'all' });
  }, 180_000);

  afterAll(async () => {
    if (ds) await destroyIntegrationDataSource(ds);
  }, 60_000);

  it('preserves historical approvals, proposals and active configuration without silently approving them', async () => {
    await ds.query(
      `INSERT INTO privileged_action_approvals
      (id,action_type,resource_type,resource_id,action_fingerprint,approval_scope,requester_principal_id,reason,status,requested_at,expires_at,approved_by,approved_at)
      VALUES ($1,'NOTIFICATION_PROVIDER_CONFIG','NOTIFICATION_PROVIDER_CONFIG',$2,$3,'notification.provider.configure','legacy-maker','synthetic legacy reason','APPROVED',NOW(),NOW()+INTERVAL '1 hour','legacy-checker',NOW())`,
      [approvalId, proposalId, 'a'.repeat(64)],
    );
    await ds.query(
      `INSERT INTO notification_provider_config_proposals
      (id,channel,expected_version,proposed_provider,proposed_enabled,proposed_base_url,credential_action,proposed_key_fingerprint,reason,status,proposer_principal_id,approval_id,action_fingerprint,decided_by,decided_at)
      VALUES ($1,'SMS',0,'robase',TRUE,'https://api.robase.dev','USE_ENV_SECRET','****tail','synthetic legacy reason','APPROVED','legacy-maker',$2,$3,'legacy-checker',NOW())`,
      [proposalId, approvalId, 'a'.repeat(64)],
    );
    await ds.query(
      `INSERT INTO notification_provider_configurations
      (channel,provider,enabled,base_url,credential_source,key_fingerprint,version,active_proposal_id,updated_by,approved_by)
      VALUES ('SMS','robase',TRUE,'https://api.robase.dev','ENV_SECRET','****tail',1,$1,'legacy-maker','legacy-checker')`,
      [proposalId],
    );
    const before = {
      config: await ds.query<unknown[]>(
        `SELECT channel,provider,enabled,credential_source,key_fingerprint,version,active_proposal_id,updated_by,approved_by FROM notification_provider_configurations`,
      ),
      proposal: await ds.query<unknown[]>(
        `SELECT id,status,reason,action_fingerprint,approval_id,decided_by FROM notification_provider_config_proposals`,
      ),
      approval: await ds.query<unknown[]>(
        `SELECT id,status,reason,action_fingerprint,approved_by FROM privileged_action_approvals`,
      ),
    };
    const upgraded = new DataSource({ ...ds.options, migrations: allMigrations as never[] });
    await ds.destroy();
    ds = upgraded;
    await ds.initialize();
    const executed = await ds.runMigrations({ transaction: 'all' });
    // Every migration after the historical cut, derived from the configured chain rather than a
    // hand-maintained list (which went stale when the KYC migrations landed).
    const expectedUpgrade = allMigrations
      .map((migration) => migration.name)
      .filter((name) => Number(name.slice(-13)) > 1785753600101 && Number(name.slice(-13)) >= 1785753600102)
      .sort((a, b) => Number(a.slice(-13)) - Number(b.slice(-13)));
    expect(executed.map((m) => m.name)).toEqual(expectedUpgrade);
    expect(await ds.showMigrations()).toBe(false);
    expect(
      await ds.query(
        `SELECT channel,provider,enabled,credential_source,key_fingerprint,version,active_proposal_id,updated_by,approved_by FROM notification_provider_configurations`,
      ),
    ).toEqual(before.config);
    expect(
      await ds.query(
        `SELECT id,status,reason,action_fingerprint,approval_id,decided_by FROM notification_provider_config_proposals`,
      ),
    ).toEqual(before.proposal);
    expect(
      await ds.query(
        `SELECT id,status,reason,action_fingerprint,approved_by FROM privileged_action_approvals`,
      ),
    ).toEqual(before.approval);
    expect(
      await ds.query(
        `SELECT credential_binding_scheme,credential_binding_key_version,credential_binding_mac FROM notification_provider_configurations`,
      ),
    ).toEqual([
      {
        credential_binding_scheme: null,
        credential_binding_key_version: null,
        credential_binding_mac: null,
      },
    ]);
    expect(
      await ds.query(
        `SELECT action_fingerprint_version,proposed_credential_source,credential_binding_scheme,credential_binding_key_version,credential_binding_mac FROM notification_provider_config_proposals`,
      ),
    ).toEqual([
      {
        action_fingerprint_version: null,
        proposed_credential_source: null,
        credential_binding_scheme: null,
        credential_binding_key_version: null,
        credential_binding_mac: null,
      },
    ]);
  });

  it('rejects partially populated or malformed metadata and refuses destructive rollback', async () => {
    await expect(
      ds.query(
        `UPDATE notification_provider_configurations SET credential_binding_scheme='HMAC_SHA256_V1' WHERE channel='SMS'`,
      ),
    ).rejects.toThrow();
    await expect(
      ds.query(
        `UPDATE notification_provider_configurations SET credential_binding_scheme='HMAC_SHA256_V1',credential_binding_key_version='v1',credential_binding_mac='bad' WHERE channel='SMS'`,
      ),
    ).rejects.toThrow();
    await expect(
      ds.query(
        `UPDATE notification_provider_config_proposals SET credential_binding_key_version='v1' WHERE id=$1`,
        [proposalId],
      ),
    ).rejects.toThrow();
    await expect(
      ds.query(
        `UPDATE notification_provider_config_proposals SET action_fingerprint_version=1 WHERE id=$1`,
        [proposalId],
      ),
    ).rejects.toThrow();
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await expect(
        new AddNotificationCredentialBinding1785753600102().down(runner),
      ).rejects.toThrow('Refusing credential-binding rollback');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    expect(
      await ds.query(`SELECT status FROM notification_provider_config_proposals WHERE id=$1`, [
        proposalId,
      ]),
    ).toEqual([{ status: 'APPROVED' }]);
    expect(
      await ds.query(
        `SELECT channel FROM notification_provider_configurations WHERE channel='SMS'`,
      ),
    ).toHaveLength(1);
  });
});
