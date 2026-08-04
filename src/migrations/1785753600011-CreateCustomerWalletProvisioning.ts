import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerWalletProvisioning1785753600011 implements MigrationInterface {
  name = 'CreateCustomerWalletProvisioning1785753600011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        type VARCHAR(20) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        closed_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_wallets_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_wallets_type CHECK (
          type IN ('PRIMARY', 'SAVINGS', 'BUSINESS', 'ESCROW')
        ),
        CONSTRAINT chk_customer_wallets_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_customer_wallets_status CHECK (
          status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')
        ),
        CONSTRAINT chk_customer_wallets_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_wallets_primary_customer
         ON customer_wallets (customer_id)
       WHERE type = 'PRIMARY' AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_wallets_customer
         ON customer_wallets (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE wallet_provisioning_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet_id UUID NOT NULL,
        action VARCHAR(30) NOT NULL,
        previous_status VARCHAR(20),
        new_status VARCHAR(20),
        actor VARCHAR(160) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_wallet_provisioning_histories_wallet
          FOREIGN KEY (wallet_id) REFERENCES customer_wallets(id) ON DELETE RESTRICT,
        CONSTRAINT chk_wallet_provisioning_histories_action CHECK (
          action IN ('PROVISIONED', 'STATUS_CHANGED', 'ALIAS_ADDED', 'OWNERSHIP_CREATED')
        ),
        CONSTRAINT chk_wallet_provisioning_histories_previous_status CHECK (
          previous_status IS NULL OR previous_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')
        ),
        CONSTRAINT chk_wallet_provisioning_histories_new_status CHECK (
          new_status IS NULL OR new_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_wallet_provisioning_histories_wallet_created
         ON wallet_provisioning_histories (wallet_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE wallet_aliases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet_id UUID NOT NULL,
        alias VARCHAR(160) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_wallet_aliases_wallet
          FOREIGN KEY (wallet_id) REFERENCES customer_wallets(id) ON DELETE RESTRICT,
        CONSTRAINT chk_wallet_aliases_alias CHECK (
          alias ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'
        ),
        CONSTRAINT chk_wallet_aliases_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_wallet_aliases_alias
         ON wallet_aliases (alias)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wallet_aliases_wallet
         ON wallet_aliases (wallet_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE wallet_ownerships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_wallet_ownerships_wallet
          FOREIGN KEY (wallet_id) REFERENCES customer_wallets(id) ON DELETE RESTRICT,
        CONSTRAINT fk_wallet_ownerships_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_wallet_ownerships_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_wallet_ownerships_wallet
         ON wallet_ownerships (wallet_id)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wallet_ownerships_customer
         ON wallet_ownerships (customer_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS wallet_ownerships`);
    await queryRunner.query(`DROP TABLE IF EXISTS wallet_aliases`);
    await queryRunner.query(`DROP TABLE IF EXISTS wallet_provisioning_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_wallets`);
  }
}
