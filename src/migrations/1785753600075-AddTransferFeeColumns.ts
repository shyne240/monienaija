import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-COMMERCIAL-IMPLEMENTATION-01 — WALLET_TRANSFER fee disclosure persistence slots.
 *
 * Additive, non-destructive: two bigint minor-unit columns with non-negative CHECKs and '0'
 * defaults on `transfers`, mirroring the existing cash_to_cash_transfers fee/vat slot
 * discipline (default '0'). Semantic: the fee/vat element ACTUALLY APPLIED (posted) to this
 * transfer. While the fee-revenue account family is unprovisioned (accounting boundary —
 * journals remain principal-only), both stay '0'; the authoritative COMPUTED fee already
 * lives in the commercial decision snapshot. Customer-facing projections read these real
 * columns instead of hardcoded literals, so the fee result is representable as
 * principal/fee/total/currency without exposing ledger internals.
 */
export class AddTransferFeeColumns1785753600075 implements MigrationInterface {
  name = 'AddTransferFeeColumns1785753600075';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE transfers ADD COLUMN fee_minor BIGINT NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE transfers ADD COLUMN vat_minor BIGINT NOT NULL DEFAULT 0`);
    await queryRunner.query(
      `ALTER TABLE transfers ADD CONSTRAINT chk_transfers_fee_non_negative CHECK (fee_minor >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE transfers ADD CONSTRAINT chk_transfers_vat_non_negative CHECK (vat_minor >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE transfers DROP CONSTRAINT chk_transfers_vat_non_negative`);
    await queryRunner.query(`ALTER TABLE transfers DROP CONSTRAINT chk_transfers_fee_non_negative`);
    await queryRunner.query(`ALTER TABLE transfers DROP COLUMN vat_minor`);
    await queryRunner.query(`ALTER TABLE transfers DROP COLUMN fee_minor`);
  }
}
