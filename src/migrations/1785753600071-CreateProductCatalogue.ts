import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-COMMERCIAL-02 — Product Catalogue foundation.
 *
 * Additive migration: creates `products`, the authoritative catalogue answering
 * "What product is this?" for future commercial configuration. It does NOT answer
 * "How much does this product cost?" — fee/commission/reward rates and limit thresholds
 * belong to separate rule systems (none created here).
 *
 * Canonical code decision (docs/V1-COMMERCIAL-02-VERIFICATION-REPORT.md):
 *  - `products.code` carries the SAME identifiers the runtime flows already pass to limit
 *    enforcement and commercial decision snapshots (WALLET_TRANSFER, WALLET_TO_CASH,
 *    CASH_TO_WALLET, CASH_TO_CASH, CUSTOMER_FUNDING, AGENT_FUNDING, AGENT_DEFUNDING).
 *  - No competing code system is introduced. QuotePaymentType stays the quote payment-type
 *    vocabulary; AgentService stays the agent service vocabulary; capability codes stay
 *    registry identities.
 *
 * The code CHECK pattern is a strict subset of the limit_rules.product pattern, so every
 * catalogue code is valid wherever product codes are already consumed.
 */
export class CreateProductCatalogue1785753600071 implements MigrationInterface {
  name = 'CreateProductCatalogue1785753600071';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE products (
        code VARCHAR(80) PRIMARY KEY CONSTRAINT chk_products_code CHECK (code ~ '^[A-Z0-9_]{3,80}$'),
        name VARCHAR(160) NOT NULL,
        description VARCHAR(500),
        domain VARCHAR(20) NOT NULL CONSTRAINT chk_products_domain CHECK (domain IN ('CUSTOMER','AGENT','AGGREGATOR','FINANCE','SUPPORT','PLATFORM')),
        currency VARCHAR(3) NOT NULL CONSTRAINT chk_products_currency CHECK (currency ~ '^[A-Z]{3}$'),
        product_scope VARCHAR(10) NOT NULL DEFAULT 'V1' CONSTRAINT chk_products_scope CHECK (product_scope IN ('V1','V2')),
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CONSTRAINT chk_products_status CHECK (status IN ('ACTIVE','DISABLED','DEPRECATED')),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        configuration_status VARCHAR(20) NOT NULL DEFAULT 'NOT_CONFIGURED' CONSTRAINT chk_products_configuration CHECK (configuration_status IN ('CONFIGURED','NOT_CONFIGURED','DISABLED')),
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_products_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_products_domain ON products (domain)`);
    await queryRunner.query(`CREATE INDEX idx_products_scope ON products (product_scope)`);
    await queryRunner.query(`CREATE INDEX idx_products_status ON products (status)`);
    await queryRunner.query(`CREATE INDEX idx_products_enabled ON products (enabled)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE products`);
  }
}
