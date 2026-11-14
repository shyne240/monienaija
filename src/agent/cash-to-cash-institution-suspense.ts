import { ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Institution-scoped Cash-to-Cash unclaimed liability ("suspense") account.
 *
 * ARENA 3B Stage 3 integration finding: the pre-institutional implementation credited a single
 * platform-wide account (`CASH_TO_CASH-UNCLAIMED-NGN`) whose `institutional_scope` is
 * `UNATTRIBUTED`. Once a funding agent's wallet is institution-attributed, the institutional
 * ledger contract refuses that journal — correctly, because it would mix an institution-scoped
 * account with an unattributed one and would let one institution's float sit in a liability no
 * institution owns.
 *
 * The unclaimed liability is therefore owned by the institution whose funding agent created the
 * obligation. It is opened by operations through the governed institution-ledger path with
 * purpose `SUSPENSE` (funds held awaiting the recipient's claim), and it is *required* — there is
 * no fallback to the legacy platform account, so a missing institution suspense account fails
 * closed instead of silently pooling institutions together.
 *
 * Historical obligations funded into the legacy unattributed account keep their original
 * posting; they remain explicitly unresolved rather than being re-attributed.
 */
export const C2C_SUSPENSE_CODE_PREFIX = 'C2C-UNCLAIMED-';

export interface InstitutionSuspenseAccount {
  id: string;
  institutionId: string;
  code: string;
}

/**
 * Resolves the institution's Cash-to-Cash suspense account inside the caller's transaction,
 * holding a SHARE lock so the account cannot be closed or re-scoped between authorization and
 * posting.
 */
export async function requireInstitutionCashToCashSuspenseAccount(
  manager: EntityManager,
  institutionId: string | null,
): Promise<InstitutionSuspenseAccount> {
  if (!institutionId)
    throw new ServiceUnavailableException(
      'Cash-to-cash institutional suspense account unavailable',
    );
  const rows: Array<{ id: string; institution_id: string; code: string }> = await manager.query(
    `SELECT id, institution_id, code
       FROM ledger_accounts
      WHERE institution_id = $1
        AND institutional_scope = 'INSTITUTION'
        AND institutional_purpose = 'SUSPENSE'
        AND code LIKE $2
        AND is_active = TRUE
      ORDER BY created_at ASC
      LIMIT 1
      FOR SHARE`,
    [institutionId, `${C2C_SUSPENSE_CODE_PREFIX}%`],
  );
  const row = rows[0];
  if (!row)
    throw new ServiceUnavailableException(
      'Cash-to-cash institutional suspense account unavailable',
    );
  return { id: row.id, institutionId: row.institution_id, code: row.code };
}

/** Non-locking read used by reconciliation/read models. */
export async function findInstitutionCashToCashSuspenseAccount(
  manager: EntityManager,
  institutionId: string,
): Promise<InstitutionSuspenseAccount | null> {
  const rows: Array<{ id: string; institution_id: string; code: string }> = await manager.query(
    `SELECT id, institution_id, code
       FROM ledger_accounts
      WHERE institution_id = $1
        AND institutional_scope = 'INSTITUTION'
        AND institutional_purpose = 'SUSPENSE'
        AND code LIKE $2
        AND is_active = TRUE
      ORDER BY created_at ASC
      LIMIT 1`,
    [institutionId, `${C2C_SUSPENSE_CODE_PREFIX}%`],
  );
  const row = rows[0];
  return row ? { id: row.id, institutionId: row.institution_id, code: row.code } : null;
}

/** The legacy platform-wide obligation account (pre-institutional transfers only). */
export const LEGACY_CASH_TO_CASH_UNCLAIMED_CODE = 'CASH_TO_CASH-UNCLAIMED-NGN';

/** Minimal query surface shared by `DataSource` and `EntityManager`. */
export interface QueryCapable {
  query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T>;
}

export interface ObligationAccount {
  id: string;
  institutionId: string | null;
}

/**
 * Resolves the obligation (unclaimed) account a transfer was funded into.
 *
 *  - A transfer with authoritative funding evidence belongs to the evidence's institution, so its
 *    obligation is that institution's suspense liability. A missing suspense account is a
 *    conflict, never a fallback.
 *  - A historical transfer with no funding evidence keeps the legacy platform-wide unattributed
 *    account it was actually posted to. It is not re-attributed and no institution is inferred.
 */
export async function resolveObligationAccountForTransfer(
  manager: EntityManager | QueryCapable,
  transferId: string,
): Promise<ObligationAccount> {
  const evidence: Array<{ institution_id: string }> = await manager.query(
    `SELECT institution_id FROM cash_to_cash_funding_evidence WHERE transfer_id = $1`,
    [transferId],
  );
  const institutionId = evidence[0]?.institution_id ?? null;
  if (institutionId) {
    const suspense = await requireInstitutionCashToCashSuspenseAccount(
      manager as EntityManager,
      institutionId,
    );
    return { id: suspense.id, institutionId };
  }
  const legacy: Array<{ id: string }> = await manager.query(
    `SELECT id FROM ledger_accounts WHERE code = $1 AND is_active = TRUE LIMIT 1`,
    [LEGACY_CASH_TO_CASH_UNCLAIMED_CODE],
  );
  const row = legacy[0];
  if (!row) throw new ServiceUnavailableException('Cash-to-cash obligation account unavailable');
  return { id: row.id, institutionId: null };
}
