import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Governed legacy wallet ownership resolution — REVIEW -> CUSTOMER / AGENT / SYSTEM.
 *
 * Migration `1785753600116` classified historical wallet owners and deliberately restricted every
 * ambiguous reference (non-canonical, unknown, or matching both a customer and an agent) as
 * `REVIEW`, then froze ownership at the database level. That left legitimate wallets permanently
 * unusable with no audited way to correct them, and no authoritative system/operational owner
 * relationship (documented as an open gap in
 * `docs/admin-one/kyc-foundation/BATCH-2C-PARTIAL.md`).
 *
 * This migration adds exactly that correction path, without ever rewriting wallet identity,
 * balances or ledger history:
 *
 *  1. `wallet_owner_ref_is_uuid` — the single canonical UUID-reference predicate reused by the
 *     partial uniqueness index and the ownership guard.
 *  2. `owner_class` catalogue extends to `SYSTEM` (platform custody), still `NOT NULL` and
 *     constraint-checked; `REVIEW` stays the fail-closed default.
 *  3. `wallet_system_owners` — the authoritative registry of system ownership designations. A
 *     SYSTEM resolution may only target a registered code, so "system owned" is never free text.
 *  4. `governed_wallet_ownership_resolutions` — the immutable evidence record tying one consumed
 *     maker-checker approval (`WALLET_OWNERSHIP_RESOLUTION` on `WALLET_ACCOUNT`) to exactly one
 *     wallet ownership resolution, including the preserved previous owner reference, the resolved
 *     class/reference, the server-verified evidence type/reference and its digest.
 *  5. The ownership guard is replaced (not weakened): `wallet_accounts.customer_id`,
 *     `ledger_account_id` and `owner_class` remain immutable for every ordinary UPDATE and for
 *     every INSERT. The ONLY accepted mutation is a REVIEW wallet transitioning once to a
 *     CUSTOMER/AGENT/SYSTEM class, and only when (a) the matching immutable resolution record
 *     already exists, (b) that record is bound to a CONSUMED approval for this exact wallet, and
 *     (c) the new owner reference genuinely resolves to exactly one authoritative
 *     customer/agent record (or is the canonical `SYSTEM:<code>` form for a registered system
 *     owner). UUID references are canonicalised to lower case on insert and on governed
 *     resolution.
 *  6. Historical UUID references are canonicalised once, and a canonical partial unique index
 *     (`lower(customer_id), currency` for UUID references) makes differently-cased duplicate
 *     owners impossible even for direct SQL inserts — the gap recorded in BATCH-2C-PARTIAL.md
 *     ("the existing case-sensitive database uniqueness constraint does not protect arbitrary
 *     direct SQL inserts of differently cased legacy UUIDs"). Genuine canonical collisions refuse
 *     the migration loudly instead of being merged or deleted; they must be reconciled by an
 *     operator through the governed workflow.
 *
 * No wallet row is deleted, no ledger account is rebound, and no balance/journal is touched.
 * `down()` deliberately refuses: dropping this would re-open unrestricted ownership mutation.
 */
export class GovernedWalletOwnershipResolution1785753600118 implements MigrationInterface {
  name = 'GovernedWalletOwnershipResolution1785753600118';

  async up(q: QueryRunner): Promise<void> {
    // 1. Canonical UUID owner-reference predicate.
    await q.query(`CREATE FUNCTION wallet_owner_ref_is_uuid(ref text) RETURNS boolean
      LANGUAGE sql IMMUTABLE AS $$
      SELECT ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    $$`);

    // 2. owner_class catalogue: REVIEW remains the fail-closed default.
    await q.query(`ALTER TABLE wallet_accounts DROP CONSTRAINT chk_wallet_owner_class`);
    await q.query(`ALTER TABLE wallet_accounts ADD CONSTRAINT chk_wallet_owner_class
      CHECK (owner_class IN ('CUSTOMER', 'AGENT', 'REVIEW', 'SYSTEM'))`);

    // 3. Authoritative system ownership registry.
    await q.query(`CREATE TABLE wallet_system_owners (
      code varchar(40) PRIMARY KEY,
      name varchar(120) NOT NULL,
      description varchar(500) NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT chk_wallet_system_owners_code CHECK (code ~ '^[A-Z][A-Z0-9_]{2,39}$')
    )`);
    await q.query(`INSERT INTO wallet_system_owners (code, name, description) VALUES
      ('PLATFORM_SUSPENSE', 'Platform suspense custody',
       'Wallet retained in platform custody pending reconciliation of unreconciled suspense movements.'),
      ('PLATFORM_SETTLEMENT', 'Platform settlement custody',
       'Wallet retained in platform custody for settlement/clearing designations with no customer or agent owner.'),
      ('PLATFORM_LEGACY', 'Platform legacy custody',
       'Legacy wallet with no identifiable customer or agent owner, preserved for operational reconciliation.')`);

    // 4. Immutable governed resolution evidence.
    await q.query(`CREATE TABLE governed_wallet_ownership_resolutions (
      approval_id uuid PRIMARY KEY REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
      wallet_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      resolution_class varchar(12) NOT NULL,
      previous_owner_ref varchar(160) NOT NULL,
      resolved_owner_ref varchar(160) NOT NULL,
      system_owner_code varchar(40) REFERENCES wallet_system_owners(code) ON DELETE RESTRICT,
      evidence_type varchar(40) NOT NULL,
      evidence_reference varchar(160) NOT NULL,
      evidence_digest char(64) NOT NULL,
      evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      reason varchar(500) NOT NULL,
      executed_by varchar(160) NOT NULL,
      executed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT chk_gwor_resolution_class
        CHECK (resolution_class IN ('CUSTOMER', 'AGENT', 'SYSTEM')),
      CONSTRAINT chk_gwor_system_owner CHECK (
        (resolution_class = 'SYSTEM' AND system_owner_code IS NOT NULL
          AND resolved_owner_ref = 'SYSTEM:' || system_owner_code)
        OR (resolution_class <> 'SYSTEM' AND system_owner_code IS NULL)
      ),
      CONSTRAINT chk_gwor_resolved_ref CHECK (
        (resolution_class IN ('CUSTOMER', 'AGENT')
          AND wallet_owner_ref_is_uuid(resolved_owner_ref)
          AND resolved_owner_ref = lower(resolved_owner_ref))
        OR resolution_class = 'SYSTEM'
      ),
      CONSTRAINT chk_gwor_evidence_type CHECK (
        (resolution_class = 'CUSTOMER'
          AND evidence_type IN ('CUSTOMER_RECORD_REFERENCE', 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING'))
        OR (resolution_class = 'AGENT' AND evidence_type = 'AGENT_RECORD_REFERENCE')
        OR (resolution_class = 'SYSTEM'
          AND evidence_type IN ('ZERO_LEDGER_ACTIVITY', 'ZERO_LEDGER_BALANCE'))
      ),
      CONSTRAINT chk_gwor_evidence_reference CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 160),
      CONSTRAINT chk_gwor_evidence_digest CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
      CONSTRAINT chk_gwor_previous_ref CHECK (length(previous_owner_ref) BETWEEN 1 AND 160),
      CONSTRAINT chk_gwor_reason CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
      CONSTRAINT chk_gwor_executed_by CHECK (length(btrim(executed_by)) BETWEEN 1 AND 160)
    )`);
    await q.query(`CREATE UNIQUE INDEX uq_gwor_wallet
      ON governed_wallet_ownership_resolutions (wallet_id)`);
    await q.query(`CREATE INDEX idx_gwor_class_executed
      ON governed_wallet_ownership_resolutions (resolution_class, executed_at DESC)`);

    // The evidence record can only exist for a CONSUMED governed approval about this exact wallet,
    // and only while the wallet is still unresolved with the same recorded previous reference.
    await q.query(`CREATE FUNCTION validate_governed_wallet_ownership_resolution() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM privileged_action_approvals a
            JOIN wallet_accounts w ON w.id = NEW.wallet_id
           WHERE a.id = NEW.approval_id
             AND a.action_type = 'WALLET_OWNERSHIP_RESOLUTION'
             AND a.resource_type = 'WALLET_ACCOUNT'
             AND lower(a.resource_id) = NEW.wallet_id::text
             AND a.status = 'CONSUMED'
             AND a.customer_id IS NULL
             AND w.owner_class = 'REVIEW'
             AND w.customer_id = NEW.previous_owner_ref
        ) THEN
          RAISE EXCEPTION 'Governed wallet ownership resolution does not match its approval and wallet'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END
    $$`);
    await q.query(`CREATE TRIGGER governed_wallet_resolution_validate
      BEFORE INSERT ON governed_wallet_ownership_resolutions FOR EACH ROW
      EXECUTE FUNCTION validate_governed_wallet_ownership_resolution()`);
    await q.query(`CREATE FUNCTION reject_wallet_ownership_resolution_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Governed wallet ownership resolutions are immutable'
          USING ERRCODE = '55000';
      END
    $$`);
    await q.query(`CREATE TRIGGER governed_wallet_resolution_immutable
      BEFORE UPDATE OR DELETE ON governed_wallet_ownership_resolutions FOR EACH ROW
      EXECUTE FUNCTION reject_wallet_ownership_resolution_mutation()`);

    // 5. Replace the ownership guard with the governed resolution path. The trigger is dropped
    //    only inside this migration transaction (which holds ACCESS EXCLUSIVE on the table), so
    //    the one-time canonicalisation below cannot race a concurrent owner write.
    await q.query(`DROP TRIGGER wallet_owner_class_guard ON wallet_accounts`);
    await q.query(`UPDATE wallet_accounts SET customer_id = lower(customer_id)
      WHERE wallet_owner_ref_is_uuid(customer_id) AND customer_id <> lower(customer_id)`);

    // 6. Refuse to invent a merge: genuine canonical collisions are reported, not resolved here.
    await q.query(`DO $$
      DECLARE offenders text;
      BEGIN
        SELECT string_agg(o.owner_ref || '/' || o.currency, ', ')
          INTO offenders
          FROM (
            SELECT lower(customer_id) AS owner_ref, currency
              FROM wallet_accounts
             WHERE wallet_owner_ref_is_uuid(customer_id)
             GROUP BY lower(customer_id), currency
            HAVING count(*) > 1
          ) o;
        IF offenders IS NOT NULL THEN
          RAISE EXCEPTION
            'Canonical wallet ownership collisions require governed reconciliation before this migration can complete: %',
            offenders
            USING ERRCODE = '23505';
        END IF;
      END
    $$`);

    await q.query(`CREATE OR REPLACE FUNCTION wallet_enforce_owner_class() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        resolution governed_wallet_ownership_resolutions%ROWTYPE;
      BEGIN
        IF NEW.customer_id IS NULL OR length(btrim(NEW.customer_id)) = 0 THEN
          RAISE EXCEPTION 'Wallet owner reference is required';
        END IF;
        IF wallet_owner_ref_is_uuid(NEW.customer_id) THEN
          NEW.customer_id := lower(NEW.customer_id);
        END IF;

        IF TG_OP = 'INSERT' THEN
          NEW.owner_class := wallet_owner_class(NEW.customer_id);
          RETURN NEW;
        END IF;

        IF NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
           AND NEW.ledger_account_id IS NOT DISTINCT FROM OLD.ledger_account_id
           AND NEW.owner_class IS NOT DISTINCT FROM OLD.owner_class THEN
          RETURN NEW;
        END IF;

        IF NEW.ledger_account_id IS DISTINCT FROM OLD.ledger_account_id THEN
          RAISE EXCEPTION 'Wallet ledger account is immutable';
        END IF;
        IF OLD.owner_class <> 'REVIEW' THEN
          RAISE EXCEPTION 'Wallet ownership is immutable';
        END IF;
        IF NEW.owner_class NOT IN ('CUSTOMER', 'AGENT', 'SYSTEM') THEN
          RAISE EXCEPTION 'Wallet ownership resolution target is unsupported';
        END IF;

        SELECT * INTO resolution
          FROM governed_wallet_ownership_resolutions g
         WHERE g.wallet_id = NEW.id
           AND g.resolution_class = NEW.owner_class
           AND g.resolved_owner_ref = NEW.customer_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Wallet ownership changes require a governed resolution'
            USING ERRCODE = '55000';
        END IF;

        IF resolution.resolution_class IN ('CUSTOMER', 'AGENT') THEN
          IF wallet_owner_class(NEW.customer_id) IS DISTINCT FROM resolution.resolution_class THEN
            RAISE EXCEPTION 'Wallet ownership target does not match an authoritative % record',
              resolution.resolution_class
              USING ERRCODE = '23514';
          END IF;
        ELSE
          IF NOT EXISTS (
            SELECT 1 FROM wallet_system_owners s
             WHERE s.code = resolution.system_owner_code AND s.is_active
          ) THEN
            RAISE EXCEPTION 'System wallet ownership target is not an active registered system owner'
              USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END
    $$`);
    await q.query(`CREATE TRIGGER wallet_owner_class_guard
      BEFORE INSERT OR UPDATE ON wallet_accounts FOR EACH ROW
      EXECUTE FUNCTION wallet_enforce_owner_class()`);

    // Canonical UUID uniqueness: immune to direct SQL inserts that differ only by UUID casing,
    // and scoped to UUID references so legacy non-UUID references are never conflated.
    await q.query(`CREATE UNIQUE INDEX uq_wallet_accounts_canonical_uuid_owner_currency
      ON wallet_accounts (lower(customer_id), currency)
      WHERE wallet_owner_ref_is_uuid(customer_id)`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Refusing to remove governed wallet ownership resolution and canonical uniqueness'),
    );
  }
}
