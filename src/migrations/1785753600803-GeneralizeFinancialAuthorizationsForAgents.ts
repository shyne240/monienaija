import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 5 — generalise the A6 financial-authorization evidence to the agent lane.
 *
 * The commitment engine shipped bound to customers only: `financial_authorizations` required a
 * customer, the validation trigger required a customer-api session, a customer transaction PIN
 * audit and a CUSTOMER wallet. The mission binds agents to the same engine — one commitment
 * architecture, one reservation, one provider operation, one settlement bridge — with the
 * authority derived from the authenticated agent instead of the customer.
 *
 * This migration is additive in effect, not a relaxation:
 *
 *  1. `financial_authorizations.agent_id` is a new nullable column referencing `agents(id)`.
 *     `customer_id` becomes nullable at the column level, but exactly one of the two is now
 *     required by `chk_financial_authorizations_owner`, and it must agree with
 *     `principal_type` and `principal_id`.
 *  2. `principal_type` widens from `= 'CUSTOMER'` to `IN ('CUSTOMER','AGENT')` — no third value is
 *     accepted, and the owner CHECK keeps the two lanes disjoint.
 *  3. The `session_id` foreign key to `authentication_sessions` is dropped. Agent lanes bind
 *     `agent_authentication_sessions` instead; a single foreign key cannot name both tables, so
 *     session validity is enforced authoritatively — as before — by the validation trigger, which
 *     is also where the agent-lane session/credential/password issuance checks live. Deletion of
 *     or updates to historical authorization rows remain refused by the immutable trigger.
 *  4. `validate_financial_authorization()` is replaced by a dual-lane function. The CUSTOMER lane
 *     is byte-for-byte the prior condition, only wrapped in its branch. The AGENT lane requires:
 *     an ACTIVE, undeleted agent; an ACTIVE, unexpired agent-api session joined to an ACTIVE
 *     agent credential with no lock, no rotation pending and a live password; an agent transaction
 *     PIN that is present, undeleted and unlocked whose `PIN_VERIFIED` audit (entity type
 *     `AGENT_TRANSACTION_PIN`) binds the exact request hash, session id and PIN version; and an
 *     AGENT-owned wallet for the same owner, ledger account and currency with `owner_class =
 *     'AGENT'` resolved by the authoritative `wallet_owner_class()`.
 *  5. `validate_financial_commitment()` keeps every check; the only change is that the provider
 *     operation's owner column is matched against `principal_id` (uuid) rather than the customer
 *     column, which is identical truth for the customer lane and correct for the agent lane.
 *
 * Nothing is weakened, renumbered, fabricated or retro-fitted: historical rows keep their meaning,
 * new agent-lane rows are bound the same way, and `down()` refuses because dropping the agent lane
 * would discard authorization evidence.
 */
export class GeneralizeFinancialAuthorizationsForAgents1785753600803 implements MigrationInterface {
  name = 'GeneralizeFinancialAuthorizationsForAgents1785753600803';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE financial_authorizations ADD COLUMN agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT`,
    );
    await q.query(`ALTER TABLE financial_authorizations ALTER COLUMN customer_id DROP NOT NULL`);
    await q.query(
      `ALTER TABLE financial_authorizations DROP CONSTRAINT IF EXISTS financial_authorizations_principal_type_check`,
    );
    await q.query(
      `ALTER TABLE financial_authorizations ADD CONSTRAINT chk_financial_authorizations_principal_type
       CHECK (principal_type IN ('CUSTOMER','AGENT'))`,
    );
    await q.query(
      `ALTER TABLE financial_authorizations ADD CONSTRAINT chk_financial_authorizations_owner CHECK (
         (principal_type = 'CUSTOMER' AND customer_id IS NOT NULL AND agent_id IS NULL AND principal_id = customer_id::text)
         OR
         (principal_type = 'AGENT' AND agent_id IS NOT NULL AND customer_id IS NULL AND principal_id = agent_id::text)
       )`,
    );
    await q.query(
      `ALTER TABLE financial_authorizations DROP CONSTRAINT IF EXISTS financial_authorizations_session_id_fkey`,
    );
    await q.query(`CREATE OR REPLACE FUNCTION validate_financial_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.principal_type = 'CUSTOMER' THEN
          IF NOT EXISTS (
            SELECT 1 FROM authentication_sessions s
            JOIN customer_transaction_pins p ON p.customer_id = s.customer_id
            JOIN audit_events a ON a.entity_id = p.id
            JOIN wallet_accounts w ON w.id = NEW.wallet_account_id
            WHERE s.id = NEW.session_id AND s.customer_id = NEW.customer_id
              AND s.status = 'ACTIVE' AND s.audience = 'customer-api' AND s.expires_at > clock_timestamp()
              AND p.deleted_at IS NULL AND p.account_locked = false
              AND a.id = NEW.pin_audit_id AND a.entity_type = 'CUSTOMER_TRANSACTION_PIN'
              AND a.action = 'PIN_VERIFIED' AND a.actor = NEW.customer_id::text
              AND a.new_values->>'customerId' = NEW.customer_id::text
              AND a.new_values->>'financialRequestHash' = NEW.request_hash
              AND a.new_values->>'sessionId' = NEW.session_id::text
              AND NEW.principal_id = NEW.customer_id::text
              AND w.customer_id = NEW.customer_id::text AND w.ledger_account_id = NEW.ledger_account_id
              AND w.owner_class = 'CUSTOMER' AND w.currency = NEW.currency
          ) THEN RAISE EXCEPTION 'Financial authorization evidence is not bound to this request'; END IF;
          RETURN NEW;
        END IF;
        IF NEW.principal_type = 'AGENT' THEN
          IF NOT EXISTS (
            SELECT 1
            FROM agents a
            JOIN agent_authentication_sessions s ON s.agent_id = a.id
            JOIN agent_authentication_credentials c ON c.id = s.credential_id AND c.agent_id = a.id
            JOIN agent_transaction_pins p ON p.agent_id = a.id
            JOIN audit_events e ON e.entity_id = p.id
            JOIN wallet_accounts w ON w.id = NEW.wallet_account_id
            WHERE a.id = NEW.agent_id AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
              AND s.id = NEW.session_id AND s.status = 'ACTIVE' AND s.audience = 'agent-api'
              AND s.expires_at > clock_timestamp()
              AND c.status = 'ACTIVE' AND c.deleted_at IS NULL AND c.rotation_required = false
              AND c.account_locked = false
              AND (c.password_expires_at IS NULL OR c.password_expires_at > clock_timestamp())
              AND s.issued_at >= c.password_changed_at
              AND p.deleted_at IS NULL AND p.account_locked = false
              AND e.id = NEW.pin_audit_id AND e.entity_type = 'AGENT_TRANSACTION_PIN'
              AND e.action = 'PIN_VERIFIED' AND e.actor = NEW.agent_id::text
              AND e.new_values->>'financialRequestHash' = NEW.request_hash
              AND e.new_values->>'sessionId' = NEW.session_id::text
              AND e.new_values->>'pinVersion' = p.pin_version::text
              AND p.last_changed_at <= e.occurred_at
              AND NEW.principal_id = NEW.agent_id::text
              AND w.customer_id = NEW.agent_id::text AND w.ledger_account_id = NEW.ledger_account_id
              AND w.owner_class = 'AGENT' AND wallet_owner_class(w.customer_id) = 'AGENT'
              AND w.currency = NEW.currency
          ) THEN RAISE EXCEPTION 'Financial authorization evidence is not bound to this request'; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Unknown financial authorization principal type';
      END $$
    `);
    await q.query(`CREATE OR REPLACE FUNCTION validate_financial_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Financial commitments cannot be deleted'; END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD.state <> 'RESERVED' OR NEW.state NOT IN ('SETTLED','RELEASED') OR
             (to_jsonb(NEW) - ARRAY['state','resolution_journal_id','resolved_at']) <>
             (to_jsonb(OLD) - ARRAY['state','resolution_journal_id','resolved_at']) THEN
            RAISE EXCEPTION 'Invalid financial commitment transition';
          END IF;
          IF NEW.state = 'RELEASED' AND NOT EXISTS (
            SELECT 1 FROM ledger_journals j WHERE j.id=NEW.resolution_journal_id
              AND j.reversal_of_journal_id=NEW.reservation_journal_id
          ) THEN RAISE EXCEPTION 'Release must reverse the reservation'; END IF;
          IF NEW.state = 'SETTLED' AND NOT EXISTS (
            SELECT 1 FROM external_settlements s WHERE s.external_operation_id=NEW.external_operation_id
              AND s.journal_id=NEW.resolution_journal_id AND s.status='POSTED'
          ) THEN RAISE EXCEPTION 'Settlement must match the external settlement'; END IF;
          RETURN NEW;
        END IF;
        IF NEW.state <> 'RESERVED' OR NOT EXISTS (
          SELECT 1 FROM financial_authorizations a
          JOIN withdrawals w ON w.id=NEW.withdrawal_id
          JOIN external_operations o ON o.id=NEW.external_operation_id
          JOIN ledger_journals j ON j.id=NEW.reservation_journal_id
          JOIN ledger_accounts r ON r.id=NEW.reserve_account_id
          WHERE a.id=NEW.authorization_id AND a.request_hash=NEW.request_hash
            AND w.wallet_id=a.wallet_account_id AND w.amount_minor=a.amount_minor AND w.currency=a.currency
            AND o.resource_type='WITHDRAWAL' AND o.resource_id=w.id AND o.customer_id=a.principal_id::uuid
            AND o.wallet_account_id=a.wallet_account_id AND o.ledger_account_id=a.ledger_account_id
            AND o.amount_minor=a.amount_minor AND o.currency=a.currency AND o.accounting_unit='CUSTOMER_FUNDS'
            AND j.currency=a.currency AND j.accounting_unit='CUSTOMER_FUNDS' AND j.status='POSTED'
            AND j.reversal_of_journal_id IS NULL
            AND r.code='PAYMENT-WITHDRAWAL_RESERVE-NGN' AND r.allow_negative_balance=false
            AND (SELECT count(*) FROM ledger_lines l WHERE l.journal_id=j.id)=2
            AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id AND l.ledger_account_id=a.ledger_account_id AND l.direction='DEBIT' AND l.amount_minor=a.amount_minor)
            AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id AND l.ledger_account_id=r.id AND l.direction='CREDIT' AND l.amount_minor=a.amount_minor)
            AND j.xmin::text::bigint=(txid_current() % 4294967296)
            AND o.xmin::text::bigint=(txid_current() % 4294967296)
            AND a.xmin::text::bigint=(txid_current() % 4294967296)
        ) THEN RAISE EXCEPTION 'Financial commitment does not match its authorization, operation and reservation'; END IF;
        RETURN NEW;
      END $$
    `);
    // G10 — destination binding must accept both customer-owned and agent-owned beneficiaries.
    // The prior trigger joined only on customer_id, which would reject every agent-lane commitment
    // even though the beneficiary, ownership and bank rows are otherwise correct per migration 0802.
    await q.query(`CREATE OR REPLACE FUNCTION validate_financial_commitment_destination() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM financial_commitments c
          JOIN financial_authorizations a ON a.id=c.authorization_id
          JOIN external_operations o ON o.id=c.external_operation_id
          JOIN customer_beneficiaries b ON b.id=NEW.beneficiary_id
          JOIN beneficiary_ownerships bo ON bo.beneficiary_id=b.id AND bo.deleted_at IS NULL
          JOIN banks k ON k.id=NEW.bank_id AND k.bank_code=NEW.bank_code
          WHERE c.id=NEW.commitment_id AND c.state='RESERVED'
            AND c.xmin::text::bigint=(txid_current() % 4294967296)
            AND (
              (a.principal_type='CUSTOMER' AND b.customer_id=a.customer_id AND bo.customer_id=a.customer_id AND b.customer_id IS NOT NULL)
              OR
              (a.principal_type='AGENT' AND b.agent_id=a.agent_id AND bo.agent_id=a.agent_id AND b.agent_id IS NOT NULL)
            )
            AND b.version=NEW.beneficiary_version AND b.status='ACTIVE' AND b.verified
            AND b.deleted_at IS NULL AND b.beneficiary_type='BANK_ACCOUNT'
            AND b.destination_identifier ~ '^[0-9]{4,32}$' AND b.destination_institution=k.bank_code
            AND k.status='ACTIVE' AND k.nip_supported
            AND NEW.target_reference='a6-target:' || encode(sha256(convert_to(
              'v1|' || b.id::text || '|' || COALESCE(b.customer_id, b.agent_id)::text || '|' || b.version::text || '|' || k.bank_code || '|' || b.destination_identifier, 'UTF8')), 'hex')
            AND o.target_mapping_reference=NEW.target_reference
        ) THEN RAISE EXCEPTION 'Destination does not match the committed beneficiary and operation'; END IF;
        RETURN NEW;
      END $$`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Refusing to discard agent-lane financial authorization evidence'),
    );
  }
}
