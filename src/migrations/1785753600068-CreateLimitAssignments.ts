import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLimitAssignments1785753600068 implements MigrationInterface {
  name = 'CreateLimitAssignments1785753600068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE limit_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        limit_profile_code VARCHAR(80) NOT NULL REFERENCES limit_profiles(code) ON DELETE RESTRICT,
        subject_type VARCHAR(20) NOT NULL CONSTRAINT chk_limit_assignments_subject_type CHECK (subject_type IN ('GLOBAL','SEGMENT','AGENT_CLASS','CUSTOMER','AGENT')),
        subject_id UUID,
        segment_code VARCHAR(80) CONSTRAINT chk_limit_assignments_segment CHECK (segment_code IS NULL OR segment_code ~ '^[A-Z0-9_]{3,80}$'),
        precedence INTEGER NOT NULL DEFAULT 0,
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_to TIMESTAMPTZ CONSTRAINT chk_limit_assignments_effective CHECK (effective_to IS NULL OR effective_to > effective_from),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_limit_assignments_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_limit_assignments_subject_consistency CHECK (
          (
            subject_type IN ('CUSTOMER','AGENT','AGENT_CLASS') AND subject_id IS NOT NULL AND segment_code IS NULL
          )
          OR
          (
            subject_type = 'SEGMENT' AND segment_code IS NOT NULL AND subject_id IS NULL
          )
          OR
          (
            subject_type = 'GLOBAL' AND subject_id IS NULL AND segment_code IS NULL
          )
        )
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_limit_assignments_profile ON limit_assignments (limit_profile_code)`);
    await queryRunner.query(`CREATE INDEX idx_limit_assignments_subject ON limit_assignments (subject_type, subject_id)`);
    await queryRunner.query(`CREATE INDEX idx_limit_assignments_segment ON limit_assignments (segment_code)`);
    await queryRunner.query(`CREATE INDEX idx_limit_assignments_effective ON limit_assignments (effective_from, effective_to)`);
    await queryRunner.query(`CREATE INDEX idx_limit_assignments_active ON limit_assignments (is_active)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_limit_assignments_active_key
      ON limit_assignments (subject_type, COALESCE(subject_id::text, ''), COALESCE(segment_code, ''), limit_profile_code, effective_from)
      WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS limit_assignments`);
  }
}
