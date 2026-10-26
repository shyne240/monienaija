import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Allow multiple identity records while rejecting duplicates in the application workflow. */
export class AllowMultipleCustomerIdentityDocuments1785753600092 implements MigrationInterface {
  name = 'AllowMultipleCustomerIdentityDocuments1785753600092';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS uq_customer_identity_document_type');
    await queryRunner.query(`
      UPDATE customer_identity_documents
      SET issued_at = NULL, expires_at = NULL
      WHERE type IN ('NIN', 'BVN')
        AND (issued_at IS NOT NULL OR expires_at IS NOT NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM customer_identity_documents
          WHERE deleted_at IS NULL
          GROUP BY customer_id, type
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION
            'Cannot restore one-document-per-type index while active duplicate document types exist';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_customer_identity_document_type
      ON customer_identity_documents (customer_id, type)
      WHERE deleted_at IS NULL
    `);
  }
}
