import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerFundingInstruments1785753600012 implements MigrationInterface {
  name = 'CreateCustomerFundingInstruments1785753600012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_funding_instruments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        instrument_type VARCHAR(30) NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        reference VARCHAR(160) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        verification_state VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_funding_instruments_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT uq_customer_funding_instruments_reference UNIQUE (reference),
        CONSTRAINT chk_customer_funding_instruments_type CHECK (
          instrument_type IN ('BANK_ACCOUNT', 'MOBILE_MONEY', 'CASH_AGENT', 'INTERNAL_SETTLEMENT')
        ),
        CONSTRAINT chk_customer_funding_instruments_status CHECK (
          status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'INACTIVE', 'REJECTED')
        ),
        CONSTRAINT chk_customer_funding_instruments_verification_state CHECK (
          verification_state IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')
        ),
        CONSTRAINT chk_customer_funding_instruments_reference CHECK (
          reference ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'
        ),
        CONSTRAINT chk_customer_funding_instruments_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_funding_instruments_customer_status
         ON customer_funding_instruments (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE funding_instrument_ownerships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instrument_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_funding_instrument_ownerships_instrument
          FOREIGN KEY (instrument_id) REFERENCES customer_funding_instruments(id) ON DELETE RESTRICT,
        CONSTRAINT fk_funding_instrument_ownerships_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_funding_instrument_ownerships_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_funding_instrument_ownerships_instrument
         ON funding_instrument_ownerships (instrument_id)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_funding_instrument_ownerships_customer
         ON funding_instrument_ownerships (customer_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE funding_instrument_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instrument_id UUID NOT NULL,
        verified_by VARCHAR(160) NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL,
        verification_method VARCHAR(80) NOT NULL,
        remarks VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_funding_instrument_verifications_instrument
          FOREIGN KEY (instrument_id) REFERENCES customer_funding_instruments(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_funding_instrument_verifications_instrument_created
         ON funding_instrument_verifications (instrument_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE funding_instrument_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instrument_id UUID NOT NULL,
        action VARCHAR(30) NOT NULL,
        previous_status VARCHAR(20),
        new_status VARCHAR(20),
        previous_verification_state VARCHAR(20),
        new_verification_state VARCHAR(20),
        actor VARCHAR(160) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_funding_instrument_histories_instrument
          FOREIGN KEY (instrument_id) REFERENCES customer_funding_instruments(id) ON DELETE RESTRICT,
        CONSTRAINT chk_funding_instrument_histories_action CHECK (
          action IN ('CREATED', 'STATUS_CHANGED', 'VERIFIED', 'OWNERSHIP_CREATED')
        ),
        CONSTRAINT chk_funding_instrument_histories_previous_status CHECK (
          previous_status IS NULL OR previous_status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'INACTIVE', 'REJECTED')
        ),
        CONSTRAINT chk_funding_instrument_histories_new_status CHECK (
          new_status IS NULL OR new_status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'INACTIVE', 'REJECTED')
        ),
        CONSTRAINT chk_funding_instrument_histories_previous_verification CHECK (
          previous_verification_state IS NULL OR previous_verification_state IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')
        ),
        CONSTRAINT chk_funding_instrument_histories_new_verification CHECK (
          new_verification_state IS NULL OR new_verification_state IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_funding_instrument_histories_instrument_created
         ON funding_instrument_histories (instrument_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS funding_instrument_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS funding_instrument_verifications`);
    await queryRunner.query(`DROP TABLE IF EXISTS funding_instrument_ownerships`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_funding_instruments`);
  }
}
