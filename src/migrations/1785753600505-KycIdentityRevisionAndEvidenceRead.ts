import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identity-bound KYC evidence read model support. Historical attempts remain unbound (NULL
 * identity_revision) and therefore cannot be promoted into automatic evidence. New attempts record
 * the current revision in the same reservation transaction; changing identity/contact/address data
 * advances the revision so old provider matches cannot be reused for a changed customer profile.
 */
export class KycIdentityRevisionAndEvidenceRead1785753600505 implements MigrationInterface {
  name = 'KycIdentityRevisionAndEvidenceRead1785753600505';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE kyc_verification_attempts ADD COLUMN identity_revision bigint CHECK(identity_revision IS NULL OR identity_revision > 0), ADD COLUMN provider_route_version integer CHECK(provider_route_version IS NULL OR provider_route_version > 0)',
    );
    await q.query('ALTER TABLE kyc_consents ADD COLUMN request_id uuid');
    await q.query('ALTER TABLE kyc_consents ADD COLUMN provider varchar(32)');
    await q.query(
      'ALTER TABLE kyc_consents ADD COLUMN route_version integer CHECK(route_version IS NULL OR route_version > 0)',
    );
    await q.query(
      'ALTER TABLE kyc_consents ADD COLUMN identity_revision bigint CHECK(identity_revision IS NULL OR identity_revision > 0)',
    );
    await q.query(
      "ALTER TABLE kyc_consents ADD CONSTRAINT chk_kyc_consent_provider_route_pair CHECK ((provider IS NULL AND route_version IS NULL AND identity_revision IS NULL) OR (provider ~ '^[A-Z][A-Z0-9_]{0,31}$' AND route_version IS NOT NULL AND identity_revision IS NOT NULL))",
    );
    await q.query(
      'CREATE UNIQUE INDEX uq_kyc_consents_customer_request ON kyc_consents(customer_id,request_id) WHERE request_id IS NOT NULL',
    );
    await q.query(`CREATE TABLE kyc_customer_identity_revisions (
      customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE RESTRICT,
      revision bigint NOT NULL CHECK(revision > 0),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`INSERT INTO kyc_customer_identity_revisions(customer_id,revision)
      SELECT id,1 FROM customers ON CONFLICT(customer_id) DO NOTHING`);

    await q.query(`CREATE FUNCTION kyc_initialize_customer_identity_revision() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO kyc_customer_identity_revisions(customer_id,revision)
        VALUES(NEW.id,1) ON CONFLICT(customer_id) DO NOTHING;
        RETURN NULL;
      END $$`);
    await q.query(`CREATE TRIGGER kyc_customer_identity_revision_created
      AFTER INSERT ON customers FOR EACH ROW EXECUTE FUNCTION kyc_initialize_customer_identity_revision()`);
    await q.query(`CREATE FUNCTION kyc_bump_customer_identity_revision_for_customer() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO kyc_customer_identity_revisions(customer_id,revision)
        VALUES(NEW.id,1)
        ON CONFLICT(customer_id) DO UPDATE SET
          revision=kyc_customer_identity_revisions.revision+1,
          updated_at=clock_timestamp();
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER kyc_customer_identity_attributes_changed
      AFTER UPDATE OF customer_type,is_synthetic,deleted_at ON customers
      FOR EACH ROW EXECUTE FUNCTION kyc_bump_customer_identity_revision_for_customer()`);

    await q.query(`CREATE FUNCTION kyc_bump_customer_identity_revision() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE subject uuid;
      BEGIN
        subject := CASE WHEN TG_OP='DELETE' THEN OLD.customer_id ELSE NEW.customer_id END;
        INSERT INTO kyc_customer_identity_revisions(customer_id,revision)
        VALUES(subject,1)
        ON CONFLICT(customer_id) DO UPDATE SET
          revision=kyc_customer_identity_revisions.revision+1,
          updated_at=clock_timestamp();
        IF TG_OP='UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
          INSERT INTO kyc_customer_identity_revisions(customer_id,revision)
          VALUES(OLD.customer_id,1)
          ON CONFLICT(customer_id) DO UPDATE SET
            revision=kyc_customer_identity_revisions.revision+1,
            updated_at=clock_timestamp();
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$`);

    // Identity detail changes invalidate KYC evidence; address/document edits also queue a fresh
    // tier evaluation because the existing 0110 refresh trigger does not cover those tables.
    const triggers: Array<{ table: string; columns: string; queueRefresh: boolean }> = [
      {
        table: 'customer_profiles',
        columns:
          'display_name,legal_name,first_name,middle_name,last_name,date_of_birth,nationality,is_active,deleted_at,customer_id',
        queueRefresh: false,
      },
      {
        table: 'customer_contact_methods',
        columns: 'type,normalized_value,is_primary,verified_at,deleted_at,customer_id',
        queueRefresh: false,
      },
      {
        table: 'customer_addresses',
        columns:
          'type,line_one,line_two,city,state,country,postal_code,is_primary,deleted_at,customer_id',
        queueRefresh: true,
      },
      {
        table: 'customer_identity_documents',
        columns: 'type,document_number,issuing_country,issued_at,expires_at,deleted_at,customer_id',
        queueRefresh: true,
      },
    ];
    for (const { table, columns, queueRefresh } of triggers) {
      const exists = (await q.query(
        `SELECT to_regclass(format('%I.%I',current_schema(),$1::text)) IS NOT NULL AS present`,
        [table],
      )) as Array<{ present: boolean }>;
      if (!exists[0]?.present) continue;
      await q.query(
        `CREATE TRIGGER kyc_customer_identity_revision_changed AFTER INSERT OR DELETE OR UPDATE OF ${columns} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION kyc_bump_customer_identity_revision()`,
      );
      if (queueRefresh) {
        const refreshFunction = (await q.query(
          `SELECT to_regprocedure(format('%I.kyc_tier_enqueue_evidence_change()',current_schema())) IS NOT NULL AS present`,
        )) as Array<{ present: boolean }>;
        if (refreshFunction[0]?.present)
          await q.query(
            `CREATE TRIGGER kyc_tier_evidence_changed AFTER INSERT OR DELETE OR UPDATE OF ${columns} ON ${table}
            FOR EACH ROW EXECUTE FUNCTION kyc_tier_enqueue_evidence_change()`,
          );
      }
    }

    // A durable, separately reviewed evidence extension point is deliberately not seeded here:
    // external evidence only enters the assessment through concrete, authorized source adapters.
    // Provider matches are read directly from their consent-bound immutable verification history.
  }

  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      `SELECT (EXISTS (SELECT 1 FROM kyc_verification_attempts WHERE identity_revision IS NOT NULL OR provider_route_version IS NOT NULL)
        OR EXISTS (SELECT 1 FROM kyc_consents WHERE request_id IS NOT NULL OR provider IS NOT NULL OR route_version IS NOT NULL OR identity_revision IS NOT NULL)
        OR EXISTS (SELECT 1 FROM kyc_customer_identity_revisions WHERE revision > 1)) AS has_data`,
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data)
      throw new Error('Refusing to remove customer identity revision or bound KYC history');

    for (const table of [
      'customer_identity_documents',
      'customer_addresses',
      'customer_contact_methods',
      'customer_profiles',
    ]) {
      const exists = (await q.query(
        `SELECT to_regclass(format('%I.%I',current_schema(),$1::text)) IS NOT NULL AS present`,
        [table],
      )) as Array<{ present: boolean }>;
      if (exists[0]?.present)
        await q.query(`DROP TRIGGER IF EXISTS kyc_customer_identity_revision_changed ON ${table}`);
    }
    for (const table of ['customer_addresses', 'customer_identity_documents']) {
      const exists = (await q.query(
        `SELECT to_regclass(format('%I.%I',current_schema(),$1::text)) IS NOT NULL AS present`,
        [table],
      )) as Array<{ present: boolean }>;
      if (exists[0]?.present)
        await q.query(`DROP TRIGGER IF EXISTS kyc_tier_evidence_changed ON ${table}`);
    }
    await q.query('DROP TRIGGER kyc_customer_identity_attributes_changed ON customers');
    await q.query('DROP FUNCTION kyc_bump_customer_identity_revision_for_customer()');
    await q.query('DROP TRIGGER kyc_customer_identity_revision_created ON customers');
    await q.query('DROP FUNCTION kyc_bump_customer_identity_revision()');
    await q.query('DROP FUNCTION kyc_initialize_customer_identity_revision()');
    await q.query('DROP TABLE kyc_customer_identity_revisions');
    await q.query('ALTER TABLE kyc_consents DROP CONSTRAINT chk_kyc_consent_provider_route_pair');
    await q.query(
      'ALTER TABLE kyc_consents DROP COLUMN request_id, DROP COLUMN provider, DROP COLUMN route_version, DROP COLUMN identity_revision',
    );
    await q.query(
      'ALTER TABLE kyc_verification_attempts DROP COLUMN identity_revision, DROP COLUMN provider_route_version',
    );
  }
}
