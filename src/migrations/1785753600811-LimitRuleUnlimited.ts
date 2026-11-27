import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allow explicit unlimited limit rules. A rule with is_unlimited=true is an explicit
 * "no cap" configuration and must be distinguishable from missing configuration.
 */
export class LimitRuleUnlimited1785753600811 implements MigrationInterface {
  name = 'LimitRuleUnlimited1785753600811';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE limit_rules ADD COLUMN is_unlimited BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    await queryRunner.query(
      `ALTER TABLE limit_rules DROP CONSTRAINT IF EXISTS chk_limit_rules_amount_count_exclusive`,
    );
    await queryRunner.query(`
      ALTER TABLE limit_rules ADD CONSTRAINT chk_limit_rules_amount_count_exclusive CHECK (
        (
          is_unlimited = TRUE
          AND limit_value_minor IS NULL
          AND limit_value_count IS NULL
          AND dimension IN ('MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','WALLET_BALANCE_MAX','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')
        )
        OR
        (
          is_unlimited = FALSE
          AND dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','WALLET_BALANCE_MAX')
          AND limit_value_minor IS NOT NULL AND limit_value_minor >= 0 AND limit_value_count IS NULL
        )
        OR
        (
          is_unlimited = FALSE
          AND dimension IN ('DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')
          AND limit_value_count IS NOT NULL AND limit_value_count >= 0 AND limit_value_minor IS NULL
        )
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT (EXISTS (SELECT 1 FROM limit_rules WHERE is_unlimited = TRUE)) AS has_unlimited`,
    )) as Array<{ has_unlimited: boolean }>;
    if (rows[0]?.has_unlimited) {
      throw new Error('Refusing to drop unlimited limit-rule support while unlimited rules exist');
    }
    await queryRunner.query(
      `ALTER TABLE limit_rules DROP CONSTRAINT IF EXISTS chk_limit_rules_amount_count_exclusive`,
    );
    await queryRunner.query(`
      ALTER TABLE limit_rules ADD CONSTRAINT chk_limit_rules_amount_count_exclusive CHECK (
        (
          dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','WALLET_BALANCE_MAX')
          AND limit_value_minor IS NOT NULL AND limit_value_minor >= 0 AND limit_value_count IS NULL
        )
        OR
        (
          dimension IN ('DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')
          AND limit_value_count IS NOT NULL AND limit_value_count >= 0 AND limit_value_minor IS NULL
        )
      )
    `);
    await queryRunner.query(`ALTER TABLE limit_rules DROP COLUMN IF EXISTS is_unlimited`);
  }
}
