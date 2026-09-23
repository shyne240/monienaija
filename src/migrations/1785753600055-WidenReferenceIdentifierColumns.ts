import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two persistence contracts declare their identifier fields as plain strings
 * while the original DDL constrained the columns to UUID:
 *
 *  - `CompleteIdempotencyCommand.resourceId?: string` vs
 *    `idempotency_records.resource_id UUID`
 *  - `AuditService.record({ entityId: string })` vs
 *    `audit_events.entity_id UUID`
 *
 * The A4 policy evidence chain records its durable decision linkage with the
 * A4 decision reference (`a4-decision-<hash>`), which is contract-conformant
 * but cannot be stored in UUID columns, making every A4-guarded evaluation
 * fail closed at the audit/idempotency completion step (HTTP 409
 * POLICY_NOT_EXECUTABLE at the gate). Widening both columns keeps every
 * existing UUID value valid (they remain plain strings) and restores the
 * intended contracts. No semantics change: reads never cast to UUID.
 */
export class WidenReferenceIdentifierColumns1785753600055 implements MigrationInterface {
  name = 'WidenReferenceIdentifierColumns1785753600055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE idempotency_records
         ALTER COLUMN resource_id TYPE VARCHAR(255) USING resource_id::text`,
    );
    await queryRunner.query(
      `ALTER TABLE audit_events
         ALTER COLUMN entity_id TYPE VARCHAR(255) USING entity_id::text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const uuidPattern =
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    await queryRunner.query(
      `UPDATE idempotency_records SET resource_id = NULL
       WHERE resource_id !~ '${uuidPattern}'`,
    );
    await queryRunner.query(
      `ALTER TABLE idempotency_records
         ALTER COLUMN resource_id TYPE UUID USING resource_id::uuid`,
    );
    await queryRunner.query(`DELETE FROM audit_events WHERE entity_id !~ '${uuidPattern}'`);
    await queryRunner.query(
      `ALTER TABLE audit_events
         ALTER COLUMN entity_id TYPE UUID USING entity_id::uuid`,
    );
  }
}
