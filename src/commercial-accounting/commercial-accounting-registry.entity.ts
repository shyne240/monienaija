import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — DP-31=A (registry-based governance evidence).
 *
 * Every accounting family/account this implementation provisions MUST carry a formal registry
 * row: the approved-accounting-family definition, its account code, the ledger geometry, the
 * human-decision references that authorized it, and the migration that provisioned it. Posting
 * code resolves accounts ONLY through this registry — a missing registry row (or a missing
 * ledger account) aborts the financial transaction (fail-closed) instead of inventing an
 * account or silently skipping accounting.
 *
 * Registry rows are seed data written by the same migration that provisions the accounts
 * (DP-30=B: migration-based provisioning, no manual post-deployment dependency).
 */
@Entity({ name: 'commercial_accounting_registry' })
@Index('uq_commercial_accounting_registry_family', ['familyCode'], { unique: true })
@Index('uq_commercial_accounting_registry_account_code', ['accountCode'], { unique: true })
export class CommercialAccountingRegistryEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** CommercialAccountingFamilyRole value (machine key used by posting code). */
  @Column({ name: 'family_code', type: 'varchar', length: 64 })
  familyCode!: string;

  @Column({ name: 'account_code', type: 'varchar', length: 100 })
  accountCode!: string;

  @Column({ name: 'account_type', type: 'varchar', length: 20 })
  accountType!: string;

  @Column({ name: 'normal_balance', type: 'varchar', length: 6 })
  normalBalance!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: string;

  /** Plain-English purpose of the family (audit trail). */
  @Column({ type: 'text' })
  purpose!: string;

  /** Human-decision identifiers authorizing this family (e.g. DP-01/DP-05 include their answers). */
  @Column({ name: 'decision_references', type: 'text', array: true, default: () => "ARRAY[]::text[]" })
  decisionReferences!: string[];

  /** Where the approval evidence lives (the human-decision task id). */
  @Column({ name: 'evidence_source', type: 'varchar', length: 255 })
  evidenceSource!: string;

  /** Provisioning identity — the migration that wrote both this row and the ledger account. */
  @Column({ name: 'provisioned_by', type: 'varchar', length: 255 })
  provisionedBy!: string;

  @CreateDateColumn({ name: 'provisioned_at', type: 'timestamptz' })
  provisionedAt!: Date;
}
