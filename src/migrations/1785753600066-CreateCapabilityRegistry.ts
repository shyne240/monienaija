import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCapabilityRegistry1785753600066 implements MigrationInterface {
  name = 'CreateCapabilityRegistry1785753600066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE capabilities (
        capability_code VARCHAR(80) PRIMARY KEY,
        domain VARCHAR(40) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description VARCHAR(800) NOT NULL,
        product_scope VARCHAR(20) NOT NULL CHECK (product_scope IN ('V1','V2')),
        lifecycle VARCHAR(40) NOT NULL CHECK (lifecycle IN ('PLANNED','DESIGNED','BACKEND_IMPLEMENTED','API_READY','ADMIN_UI_READY','CUSTOMER_UI_READY','AGENT_UI_READY','FULLY_ENABLED','DISABLED','BLOCKED','DEPRECATED')),
        backend_status VARCHAR(40) NOT NULL CHECK (backend_status IN ('PLANNED','DESIGNED','BACKEND_IMPLEMENTED','DISABLED','DEPRECATED','BLOCKED')),
        api_status VARCHAR(40) NOT NULL CHECK (api_status IN ('NOT_EXPOSED','API_READY','DEPRECATED')),
        admin_ui_status VARCHAR(40) NOT NULL CHECK (admin_ui_status IN ('NOT_EXPOSED','ADMIN_UI_READY','DEPRECATED')),
        customer_ui_status VARCHAR(40) NOT NULL CHECK (customer_ui_status IN ('NOT_EXPOSED','CUSTOMER_UI_READY','DEPRECATED')),
        agent_ui_status VARCHAR(40) NOT NULL CHECK (agent_ui_status IN ('NOT_EXPOSED','AGENT_UI_READY','DEPRECATED')),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        configuration_status VARCHAR(40) NOT NULL CHECK (configuration_status IN ('NOT_CONFIGURED','CONFIGURED','DISABLED')),
        dependencies JSONB,
        implementation_references JSONB,
        migration_references JSONB,
        test_references JSONB,
        documentation_references JSONB,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        owner VARCHAR(80),
        blocker_type VARCHAR(40) NOT NULL DEFAULT 'NONE' CHECK (blocker_type IN ('NONE','PRODUCT_DECISION','ACCOUNTING_DECISION','EXTERNAL_DEPENDENCY','V2')),
        blocker_description VARCHAR(800),
        notes VARCHAR(800),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_capabilities_domain ON capabilities (domain)`);
    await queryRunner.query(`CREATE INDEX idx_capabilities_product_scope ON capabilities (product_scope)`);
    await queryRunner.query(`CREATE INDEX idx_capabilities_backend_status ON capabilities (backend_status)`);
    await queryRunner.query(`CREATE INDEX idx_capabilities_enabled ON capabilities (enabled)`);
    await queryRunner.query(`CREATE INDEX idx_capabilities_lifecycle ON capabilities (lifecycle)`);
    await queryRunner.query(`CREATE INDEX idx_capabilities_blocker_type ON capabilities (blocker_type)`);

    // Seed via direct insert of all known V1/V2 capabilities — generated from src/capability-registry/capability.seed.ts
    // For durability, also allow service to seed if table empty (idempotent)
    // Minimal seed: insert a marker row; full seed will be handled by application startup seed service
    // Here we insert all 103 capabilities directly for idempotent migration (ON CONFLICT DO NOTHING)
    // To avoid huge migration, seed will be done via CapabilitySeedService on startup; this migration only creates table
    // Full seed is in src/capability-registry/capability.seed.ts and executed via service
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS capabilities`);
  }
}
