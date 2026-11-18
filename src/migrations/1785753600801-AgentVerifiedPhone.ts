import type { MigrationInterface, QueryRunner } from 'typeorm';

/** An allocated receiving identifier is not phone proof; legacy agents remain unverified. */
export class AgentVerifiedPhone1785753600801 implements MigrationInterface {
  name = 'AgentVerifiedPhone1785753600801';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE agent_verified_phone_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      canonical_phone varchar(10) NOT NULL CHECK (canonical_phone ~ '^[789][0-9]{9}$'),
      verified_at timestamptz NOT NULL,
      proof_challenge_id uuid NOT NULL UNIQUE REFERENCES customer_registration_phone_challenges(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      revoked_at timestamptz,
      CHECK (revoked_at IS NULL OR revoked_at >= created_at)
    )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_agent_verified_phone_live_agent ON agent_verified_phone_contacts(agent_id) WHERE revoked_at IS NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_agent_verified_phone_live_number ON agent_verified_phone_contacts(canonical_phone) WHERE revoked_at IS NULL`,
    );
    await q.query(`CREATE FUNCTION guard_agent_verified_phone_contact() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE proof customer_registration_phone_challenges%ROWTYPE;
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Verified agent contact evidence cannot be deleted'; END IF;
        IF TG_OP='INSERT' THEN
          SELECT * INTO proof FROM customer_registration_phone_challenges WHERE id=NEW.proof_challenge_id FOR SHARE;
          IF NOT FOUND OR proof.status <> 'VERIFIED' OR proof.revoked_at IS NOT NULL OR proof.consumed_at IS NULL
             OR proof.normalized_phone <> NEW.canonical_phone OR proof.verified_at IS DISTINCT FROM NEW.verified_at
             OR NEW.revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'Verified agent phone requires consumed matching phone proof';
          END IF;
          RETURN NEW;
        END IF;
        IF ROW(NEW.id,NEW.agent_id,NEW.canonical_phone,NEW.verified_at,NEW.proof_challenge_id,NEW.created_at)
             IS DISTINCT FROM ROW(OLD.id,OLD.agent_id,OLD.canonical_phone,OLD.verified_at,OLD.proof_challenge_id,OLD.created_at)
           OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
          RAISE EXCEPTION 'Verified agent contact evidence is immutable';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER agent_verified_phone_contact_guard BEFORE INSERT OR UPDATE OR DELETE ON agent_verified_phone_contacts
      FOR EACH ROW EXECUTE FUNCTION guard_agent_verified_phone_contact()`);
    await q.query(`CREATE TABLE agent_notification_preferences (
      agent_id uuid PRIMARY KEY REFERENCES agents(id) ON DELETE RESTRICT,
      sms_enabled boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard verified agent contact evidence'));
  }
}
