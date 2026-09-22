import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1 primary MonieNaija receiving numbers.
 *
 * Creates the dedicated receiving-number abstraction (globally unique,
 * exactly-10-digit, system-issued, 1:1-at-a-time with an ACTIVE PRIMARY
 * CustomerWallet), extends the wallet provisioning history action vocabulary
 * with RECEIVING_NUMBER_ISSUED, and backfills deterministic numbers for all
 * already-eligible ACTIVE primary wallets.
 *
 * Backfill determinism: number = nationalSignificantNumber(canonical +234
 * phone). Canonical-phone uniqueness (uq_customer_contacts_type_value) makes
 * genuine digit collisions structurally impossible for PRIMARY phones; any
 * residual conflict (e.g. a wallet whose customer's earliest canonical phone
 * is shared by a second ACTIVE wallet — impossible under
 * uq_customer_wallets_primary_customer) is surfaced explicitly via RAISE
 * NOTICE listing every skipped (wallet, number) conflict instead of silently
 * overwriting or randomly reassigning.
 */
export class CreateCustomerReceivingNumbers1785753600053 implements MigrationInterface {
  name = 'CreateCustomerReceivingNumbers1785753600053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_receiving_numbers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        wallet_id UUID NOT NULL,
        number VARCHAR(10) NOT NULL,
        source VARCHAR(30) NOT NULL DEFAULT 'PHONE_NSN',
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        derived_from_phone VARCHAR(16),
        version INTEGER NOT NULL DEFAULT 1,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deactivated_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_receiving_numbers_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_receiving_numbers_wallet
          FOREIGN KEY (wallet_id) REFERENCES customer_wallets(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_receiving_numbers_number CHECK (number ~ '^[0-9]{10}$'),
        CONSTRAINT chk_customer_receiving_numbers_status CHECK (
          status IN ('ACTIVE', 'REVOKED')
        ),
        CONSTRAINT chk_customer_receiving_numbers_source CHECK (
          source IN ('PHONE_NSN')
        ),
        CONSTRAINT chk_customer_receiving_numbers_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_receiving_numbers_number
         ON customer_receiving_numbers (number)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_receiving_numbers_active_wallet
         ON customer_receiving_numbers (wallet_id)
       WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_receiving_numbers_customer
         ON customer_receiving_numbers (customer_id, status)`,
    );

    await queryRunner.query(
      `ALTER TABLE wallet_provisioning_histories
         DROP CONSTRAINT chk_wallet_provisioning_histories_action`,
    );
    await queryRunner.query(
      `ALTER TABLE wallet_provisioning_histories
         ADD CONSTRAINT chk_wallet_provisioning_histories_action CHECK (
           action IN (
             'PROVISIONED',
             'STATUS_CHANGED',
             'ALIAS_ADDED',
             'OWNERSHIP_CREATED',
             'RECEIVING_NUMBER_ISSUED'
           )
         )`,
    );

    // Deterministic V1 backfill. canonical phone = +234(70|80|81|90|91)########.
    // Rows that would collide are NOT written; each is reported explicitly.
    await queryRunner.query(`
      DO $$
      DECLARE
        candidate RECORD;
        inserted_row RECORD;
        conflicts INTEGER := 0;
      BEGIN
        FOR candidate IN
          SELECT DISTINCT ON (cw.id)
            cw.id AS wallet_id,
            cw.customer_id AS customer_id,
            substring(cm.normalized_value FROM 5) AS number,
            cm.normalized_value AS canonical_phone
          FROM customer_wallets cw
          JOIN customers c
            ON c.id = cw.customer_id
           AND c.status = 'ACTIVE'
           AND c.deleted_at IS NULL
          JOIN customer_contact_methods cm
            ON cm.customer_id = cw.customer_id
           AND cm.type = 'PHONE'
           AND cm.deleted_at IS NULL
           AND cm.normalized_value ~ '^\\+234(70|80|81|90|91)[0-9]{8}$'
          WHERE cw.type = 'PRIMARY'
            AND cw.status = 'ACTIVE'
            AND cw.deleted_at IS NULL
          ORDER BY cw.id, cm.is_primary DESC, cm.created_at ASC, cm.id ASC
        LOOP
          BEGIN
            INSERT INTO customer_receiving_numbers (
              id,
              customer_id,
              wallet_id,
              number,
              source,
              status,
              derived_from_phone
            )
            VALUES (
              gen_random_uuid(),
              candidate.customer_id,
              candidate.wallet_id,
              candidate.number,
              'PHONE_NSN',
              'ACTIVE',
              candidate.canonical_phone
            );
          EXCEPTION WHEN unique_violation THEN
            conflicts := conflicts + 1;
            RAISE NOTICE 'RECEIVING_NUMBER_BACKFILL_COLLISION wallet=% customer=% number=% (kept existing authoritative row; no overwrite, no reassignment)',
              candidate.wallet_id,
              candidate.customer_id,
              candidate.number;
          END;
        END LOOP;
        RAISE NOTICE 'RECEIVING_NUMBER_BACKFILL_COMPLETE conflicts=%', conflicts;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE wallet_provisioning_histories
         DROP CONSTRAINT chk_wallet_provisioning_histories_action`,
    );
    await queryRunner.query(
      `ALTER TABLE wallet_provisioning_histories
         ADD CONSTRAINT chk_wallet_provisioning_histories_action CHECK (
           action IN ('PROVISIONED', 'STATUS_CHANGED', 'ALIAS_ADDED', 'OWNERSHIP_CREATED')
         )`,
    );
    await queryRunner.query(`DROP TABLE customer_receiving_numbers`);
  }
}
