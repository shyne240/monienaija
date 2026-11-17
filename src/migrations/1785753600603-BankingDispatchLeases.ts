import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D banking — dispatch leases and dispatch history.
 *
 * The outbound worker needs three things from the database that application memory cannot provide:
 * exclusive ownership across processes, survival of a crash mid-dispatch, and an audit trail of every
 * attempt. A lease table provides all three.
 *
 * Deliberate design points:
 *
 * - a lease is **per operation**, not per worker. Two workers can never hold the same operation, which
 *   is what stops a duplicate dispatch under concurrency;
 * - expiry is evaluated against the database clock, so a worker with a skewed clock cannot steal a
 *   live lease, and a dead worker's lease becomes reclaimable without any coordination;
 * - `attempts` is bounded. After the bound the operation is parked in MANUAL_REVIEW rather than
 *   retried forever, because an operation that keeps failing enquiry needs a human, not a loop;
 * - history is append-only. Every dispatch attempt is recorded with its outcome, including the ones
 *   that learned nothing, so an uncertain transfer can be reconstructed later.
 */
export class BankingDispatchLeases1785753600603 implements MigrationInterface {
  name = 'BankingDispatchLeases1785753600603';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE banking_dispatch_leases (
      operation_id uuid PRIMARY KEY
        REFERENCES banking_outbound_operations(id) ON DELETE RESTRICT,
      lease_owner varchar(160) NOT NULL,
      -- Database-clock expiry. Never a client-supplied timestamp.
      leased_until timestamptz NOT NULL,
      acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      -- Incremented on every acquisition so a stale holder can detect that it lost the lease.
      fence integer NOT NULL DEFAULT 1 CHECK(fence > 0)
    )`);
    await q.query(`CREATE INDEX idx_banking_dispatch_leases_expiry
      ON banking_dispatch_leases(leased_until)`);

    await q.query(`CREATE TABLE banking_dispatch_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      operation_id uuid NOT NULL
        REFERENCES banking_outbound_operations(id) ON DELETE RESTRICT,
      attempt_number integer NOT NULL CHECK(attempt_number > 0),
      lease_owner varchar(160) NOT NULL,
      fence integer NOT NULL,
      action varchar(16) NOT NULL CHECK(action IN ('DISPATCH','ENQUIRE','ESCALATE')),
      outcome varchar(32) NOT NULL,
      -- Null when the attempt learned nothing about the money; that is itself the recorded fact.
      provider_status varchar(64),
      error_code varchar(64),
      started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      finished_at timestamptz,
      UNIQUE(operation_id,attempt_number,action)
    )`);
    await q.query(`CREATE INDEX idx_banking_dispatch_attempts_operation
      ON banking_dispatch_attempts(operation_id,started_at DESC)`);

    // History is evidence of what was attempted. It is never edited or removed.
    await q.query(`CREATE FUNCTION public.banking_dispatch_attempt_immutable()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Dispatch history is never deleted' USING ERRCODE='55000';
        END IF;
        -- Completion of an attempt may be recorded; the attempt itself may not be rewritten.
        IF OLD.operation_id IS DISTINCT FROM NEW.operation_id
           OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number
           OR OLD.action IS DISTINCT FROM NEW.action
           OR OLD.lease_owner IS DISTINCT FROM NEW.lease_owner
           OR OLD.started_at IS DISTINCT FROM NEW.started_at THEN
          RAISE EXCEPTION 'Dispatch attempt evidence is immutable' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER trg_banking_dispatch_attempt_immutable
      BEFORE UPDATE OR DELETE ON banking_dispatch_attempts
      FOR EACH ROW EXECUTE FUNCTION public.banking_dispatch_attempt_immutable()`);

    await q.query(`REVOKE ALL ON public.banking_dispatch_leases FROM PUBLIC`);
    await q.query(`REVOKE ALL ON public.banking_dispatch_attempts FROM PUBLIC`);
    await q.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON public.banking_dispatch_leases TO monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT,INSERT,UPDATE ON public.banking_dispatch_attempts TO monienaija_runtime`,
    );
    // The attempt trigger enforces append-only; the grant withholds DELETE so the guard is not the
    // only line of defence.
    await q.query(
      `REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.banking_dispatch_attempts FROM monienaija_runtime`,
    );
    await q.query(
      `REVOKE TRUNCATE,REFERENCES,TRIGGER ON public.banking_dispatch_leases FROM monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT ON public.banking_dispatch_leases, public.banking_dispatch_attempts
        TO monienaija_authority_core`,
    );
  }

  async down(): Promise<void> {
    return Promise.reject(
      new Error('Refusing to remove dispatch history: it is financial evidence'),
    );
  }
}
