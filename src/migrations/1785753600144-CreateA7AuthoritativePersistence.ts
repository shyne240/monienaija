import type { MigrationInterface, QueryRunner } from 'typeorm';

/** A7 command facts and current state. These records do not authorize financial posting. */
export class CreateA7AuthoritativePersistence1785753600144 implements MigrationInterface {
  name = 'CreateA7AuthoritativePersistence1785753600144';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE a7_product_commands (
      id uuid PRIMARY KEY,
      command_reference varchar(100) NOT NULL UNIQUE,
      operation_type varchar(30) NOT NULL CHECK (operation_type IN ('VIRTUAL_ACCOUNT_ASSIGN','INBOUND_FUNDING')),
      customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      session_id uuid NOT NULL REFERENCES authentication_sessions(id) ON DELETE RESTRICT,
      authorization_event_id uuid NOT NULL REFERENCES audit_events(id) ON DELETE RESTRICT,
      binding_id uuid NOT NULL REFERENCES customer_financial_account_bindings(id) ON DELETE RESTRICT,
      binding_version integer NOT NULL CHECK (binding_version > 0),
      customer_wallet_id uuid NOT NULL REFERENCES customer_wallets(id) ON DELETE RESTRICT,
      wallet_account_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
      virtual_account_id uuid REFERENCES virtual_accounts(id) ON DELETE RESTRICT,
      policy_decision_reference varchar(180) REFERENCES policy_decision_records(decision_reference) ON DELETE RESTRICT,
      inbound_observation_id uuid REFERENCES inbound_funding_observations(id) ON DELETE RESTRICT,
      inbound_provider_key varchar(80),
      inbound_reference_hash char(64),
      idempotency_key_hash char(64) NOT NULL CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
      request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(customer_id,idempotency_key_hash),
      CHECK (operation_type='INBOUND_FUNDING' OR (inbound_observation_id IS NULL AND virtual_account_id IS NULL)),
      CHECK ((inbound_observation_id IS NULL AND inbound_provider_key IS NULL AND inbound_reference_hash IS NULL) OR
        (inbound_observation_id IS NOT NULL AND virtual_account_id IS NOT NULL AND inbound_provider_key IS NOT NULL AND inbound_reference_hash ~ '^[a-f0-9]{64}$'))
    )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_a7_inbound_reference_command ON a7_product_commands(inbound_provider_key,inbound_reference_hash) WHERE inbound_observation_id IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_a7_inbound_observation_command ON a7_product_commands(inbound_observation_id) WHERE inbound_observation_id IS NOT NULL`,
    );
    await q.query(
      `CREATE TRIGGER a7_product_command_immutable BEFORE UPDATE OR DELETE ON a7_product_commands FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`,
    );
    await q.query(`CREATE TABLE a7_product_lifecycles (
      id uuid PRIMARY KEY,
      lifecycle_reference varchar(100) NOT NULL UNIQUE,
      command_id uuid NOT NULL UNIQUE REFERENCES a7_product_commands(id) ON DELETE RESTRICT,
      state varchar(40) NOT NULL CHECK (state IN ('LIFECYCLE_PENDING','LIFECYCLE_ADMITTED','LIFECYCLE_UNKNOWN','LIFECYCLE_MANUAL_REVIEW','LIFECYCLE_CANCELLED')),
      version integer NOT NULL CHECK (version > 0),
      execution_receipt_id uuid REFERENCES inbound_funding_receipts(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (execution_receipt_id IS NULL)
    )`);
    await q.query(`CREATE TABLE a7_product_lifecycle_transitions (
      id uuid PRIMARY KEY,
      lifecycle_id uuid NOT NULL REFERENCES a7_product_lifecycles(id) ON DELETE RESTRICT,
      from_state varchar(40) NOT NULL,
      to_state varchar(40) NOT NULL,
      from_version integer NOT NULL,
      to_version integer NOT NULL,
      authorization_event_id uuid NOT NULL REFERENCES audit_events(id) ON DELETE RESTRICT,
      idempotency_key_hash char(64) NOT NULL CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
      request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(lifecycle_id,idempotency_key_hash), UNIQUE(lifecycle_id,to_version),
      CHECK (to_version = from_version + 1)
    )`);
    await q.query(
      `CREATE TRIGGER a7_product_lifecycle_transition_immutable BEFORE UPDATE OR DELETE ON a7_product_lifecycle_transitions FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`,
    );
    await q.query(`CREATE FUNCTION guard_a7_product_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'A7 lifecycle cannot be deleted'; END IF;
        IF TG_OP='INSERT' THEN
          IF NEW.state <> 'LIFECYCLE_PENDING' OR NEW.version <> 1 OR NEW.execution_receipt_id IS NOT NULL THEN
            RAISE EXCEPTION 'A7 lifecycle must begin pending'; END IF;
          RETURN NEW;
        END IF;
        IF NEW.id<>OLD.id OR NEW.command_id<>OLD.command_id OR NEW.lifecycle_reference<>OLD.lifecycle_reference OR
           NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.execution_receipt_id IS NOT NULL OR
           NOT ((OLD.state='LIFECYCLE_PENDING' AND NEW.state IN ('LIFECYCLE_ADMITTED','LIFECYCLE_CANCELLED')) OR
                (OLD.state='LIFECYCLE_ADMITTED' AND NEW.state='LIFECYCLE_UNKNOWN') OR
                (OLD.state='LIFECYCLE_UNKNOWN' AND NEW.state='LIFECYCLE_MANUAL_REVIEW')) OR
           NOT EXISTS (SELECT 1 FROM a7_product_lifecycle_transitions t WHERE t.lifecycle_id=OLD.id
             AND t.from_state=OLD.state AND t.to_state=NEW.state AND t.from_version=OLD.version AND t.to_version=NEW.version
             AND t.xmin::text::bigint=(txid_current() % 4294967296))
        THEN RAISE EXCEPTION 'Invalid A7 lifecycle transition'; END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER a7_product_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON a7_product_lifecycles FOR EACH ROW EXECUTE FUNCTION guard_a7_product_lifecycle()`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove A7 command and lifecycle evidence'));
  }
}
