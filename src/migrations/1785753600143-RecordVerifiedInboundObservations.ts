import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Verified arrival evidence is durable even when no accounting policy permits posting. */
export class RecordVerifiedInboundObservations1785753600143 implements MigrationInterface {
  name = 'RecordVerifiedInboundObservations1785753600143';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE inbound_funding_observations (
      id uuid PRIMARY KEY,
      provider_key varchar(80) NOT NULL,
      provider_reference varchar(160) NOT NULL,
      provider_reference_hash char(64) NOT NULL CHECK (provider_reference_hash ~ '^[a-f0-9]{64}$'),
      evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
      bank_code varchar(20) NOT NULL,
      account_number varchar(32) NOT NULL,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      provider_observed_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(provider_key,provider_reference_hash,evidence_hash)
    )`);
    await q.query(`CREATE TRIGGER inbound_funding_observation_immutable BEFORE UPDATE OR DELETE ON inbound_funding_observations
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove verified inbound evidence'));
  }
}
