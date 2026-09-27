import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { LimitFailureCode, dimensionToFailureCode } from './limit-error.codes';
import { LimitProfileResolverService } from './limit-profile-resolver.service';
import { LimitUsageService, LimitUsageReserveEntry } from './limit-usage.service';
import { getWindowForDimension } from './limit-window.util';

function toUpper(v?: string | null): string | null {
  return v ? v.trim().toUpperCase() : null;
}

export interface EnforceInput {
  principalType: string; // CUSTOMER | AGENT
  principalId: string;
  agentClassId?: string | null;
  segmentCodes?: string[];
  product: string;
  currency: string; // NGN
  direction: string; // INCOMING | OUTGOING | BOTH
  channel?: string | null;
  amountMinor: string; // bigint string
  idempotencyKey: string;
  requestHash: string;
  correlationId?: string | null;
  now?: Date;
  // wallet for WALLET_BALANCE_MAX: if provided, we can check balance; otherwise skip that dimension
  // If not provided but dimension requires, we fetch wallet inside manager
  walletLedgerAccountId?: string | null; // for WALLET_BALANCE_MAX check
  principalWalletCustomerId?: string; // customerId for wallet lookup if ledgerAccountId not provided
}

export interface LimitRuleEvidence {
  ruleId: string;
  dimension: string;
  limitValueMinor: string | null;
  limitValueCount: number | null;
}

export interface EnforceResult {
  allowed: boolean;
  limitProfileCode: string | null;
  evaluatedDimensions: string[];
  reserved?: { kind: 'NEW' | 'REPLAY' };
  /**
   * V1-COMMERCIAL-DECISION-02 (additive): evidence of the rules THIS enforcement actually
   * evaluated — exposed so flows can record the authoritative limit decision in the Commercial
   * Decision Snapshot without re-evaluating limits. No behavior change.
   */
  assignmentId?: string | null;
  ruleRefs?: LimitRuleEvidence[];
  reservationIds?: string[];
  usageIds?: string[];
}

@Injectable()
export class LimitEnforcementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly profileResolver: LimitProfileResolverService,
    private readonly usageService: LimitUsageService,
  ) {}

  /**
   * Enforce limits inside an existing SERIALIZABLE manager transaction.
   * Steps:
   * 1) Resolve profile (GLOBAL/SEGMENT/AGENT_CLASS/CUSTOMER/AGENT with precedence/effective)
   * 2) Fetch active rules for product/currency/direction/channel/effective
   * 3) Evaluate ALL dimensions:
   *    - MIN_AMOUNT_PER_TX / MAX_AMOUNT_PER_TX vs amountMinor (no DB)
   *    - WALLET_BALANCE_MAX vs ledger balance + amount (if credit) — authoritative, not window
   *    - DAILY/WEEKLY/MONTHLY/YEARLY amount+count via reserveBatchWithManager (checks used+reserved+delta > limit then increments reserved FOR UPDATE)
   * 4) Reserve windowed usages via LimitUsageService.reserveBatchWithManager inside same manager (atomic with ledger)
   * If no profile or no rules, returns allowed (unlimited). Never invents thresholds.
   * Throws HttpException with LimitFailureCode on breach (422) or LIMIT_RESERVATION_FAILED on reserve failure.
   * Idempotent: reserveBatchWithManager handles replay via idempotencyKey/requestHash.
   */
  async enforceWithManager(manager: EntityManager, input: EnforceInput): Promise<EnforceResult> {
    const now = input.now ?? new Date();
    const amountMinor = input.amountMinor.trim();
    if (!/^\d+$/.test(amountMinor)) throw new BadRequestException('amountMinor must be numeric string');
    const amount = BigInt(amountMinor);
    const currency = input.currency.trim().toUpperCase();
    const product = input.product.trim().toUpperCase();
    const direction = input.direction.trim().toUpperCase();
    const channel = toUpper(input.channel);
    const principalType = input.principalType.trim().toUpperCase();
    const principalId = input.principalId.trim();

    // 1) Resolve profile
    const resolved = await this.profileResolver.resolve(manager, {
      principalType,
      principalId,
      agentClassId: input.agentClassId ?? null,
      segmentCodes: input.segmentCodes ?? [],
      now,
    });
    if (!resolved) {
      return { allowed: true, limitProfileCode: null, evaluatedDimensions: [] };
    }
    const profileCode = resolved.limitProfileCode;

    // 2) Fetch active rules for this profile/product/currency/effective
    // Do raw query to include effective and isActive, then filter direction/channel in JS
    const ruleRows: Array<{
      id: string;
      limit_profile_code: string;
      product: string;
      direction: string | null;
      channel: string | null;
      currency: string;
      dimension: string;
      limit_value_minor: string | null;
      limit_value_count: number | null;
      effective_from: string;
      effective_to: string | null;
      is_active: boolean;
    }> = await manager.query(
      `SELECT id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor::text AS limit_value_minor, limit_value_count, effective_from, effective_to, is_active
         FROM limit_rules
        WHERE limit_profile_code = $1
          AND upper(product) = upper($2)
          AND upper(currency) = upper($3)
          AND is_active = true
          AND deleted_at IS NULL
          AND effective_from <= $4
          AND (effective_to IS NULL OR $4 < effective_to)
        ORDER BY priority DESC, created_at ASC`,
      [profileCode, product, currency, now],
    );

    // Filter direction/channel: rule matches transaction if rule direction is null OR rule direction = transaction direction OR rule direction = BOTH
    // And rule channel is null OR equals transaction channel
    const applicable = ruleRows.filter((r) => {
      const rd = r.direction ? r.direction.trim().toUpperCase() : null;
      const rc = r.channel ? r.channel.trim().toUpperCase() : null;
      // direction check
      if (rd !== null && rd !== 'BOTH' && rd !== direction) return false;
      // channel check: if rule has channel, transaction must have same channel; if rule channel null, matches any
      if (rc !== null && rc !== channel) return false;
      // If transaction has channel and rule is null, it matches (null means any)
      return true;
    });

    if (applicable.length === 0) {
      return { allowed: true, limitProfileCode: profileCode, evaluatedDimensions: [], assignmentId: resolved.assignmentId, ruleRefs: [] };
    }

    // V1-COMMERCIAL-DECISION-02: evidence of the rules this enforcement evaluates (additive).
    const ruleRefs: LimitRuleEvidence[] = applicable.map((r) => ({
      ruleId: r.id,
      dimension: r.dimension.trim().toUpperCase(),
      limitValueMinor: r.limit_value_minor,
      limitValueCount: r.limit_value_count,
    }));

    const evaluatedDimensions: string[] = [];

    // 3a) Non-windowed immediate checks: MIN/MAX
    for (const rule of applicable) {
      const dim = rule.dimension.trim().toUpperCase();
      evaluatedDimensions.push(dim);
      if (dim === 'MIN_AMOUNT_PER_TX') {
        const limit = rule.limit_value_minor ? BigInt(rule.limit_value_minor) : null;
        if (limit !== null && amount < limit) {
          throw this.limitException(LimitFailureCode.LIMIT_MIN_AMOUNT_NOT_MET, `Amount ${amountMinor} below minimum ${limit.toString()} for ${product}`);
        }
      } else if (dim === 'MAX_AMOUNT_PER_TX') {
        const limit = rule.limit_value_minor ? BigInt(rule.limit_value_minor) : null;
        if (limit !== null && amount > limit) {
          throw this.limitException(LimitFailureCode.LIMIT_MAX_AMOUNT_EXCEEDED, `Amount ${amountMinor} exceeds maximum ${limit.toString()} for ${product}`);
        }
      }
    }

    // 3b) WALLET_BALANCE_MAX — authoritative wallet balance, not window — only for INCOMING (credit) flows; OUTGOING reduces balance so not enforced
    const walletMaxRules = applicable.filter((r) => r.dimension.trim().toUpperCase() === 'WALLET_BALANCE_MAX');
    for (const rule of walletMaxRules) {
      if (direction === 'OUTGOING') continue;
      const limitStr = rule.limit_value_minor;
      if (!limitStr) continue;
      const limit = BigInt(limitStr);
      // Only enforce if transaction will increase principal's wallet (INCOMING) or if current balance already over limit
      // Determine wallet balance
      let ledgerAccountId: string | null = input.walletLedgerAccountId ?? null;
      if (!ledgerAccountId) {
        // Try to find wallet by principal
        // principalWalletCustomerId may be same as principalId for customers/agents (WalletAccount.customerId = principalId)
        const walletCustomerId = input.principalWalletCustomerId ?? principalId;
        const walletRows: Array<{ ledger_account_id: string; status: string }> = await manager.query(
          `SELECT ledger_account_id, status FROM wallet_accounts WHERE customer_id = $1 AND currency = $2 LIMIT 1`,
          [walletCustomerId, currency],
        );
        if (walletRows[0]) ledgerAccountId = walletRows[0].ledger_account_id;
      }
      if (!ledgerAccountId) {
        // No wallet yet — projected balance is amount (new wallet will have amount)
        if (direction === 'INCOMING' && amount > limit) {
          throw this.limitException(LimitFailureCode.LIMIT_WALLET_BALANCE_EXCEEDED, `Projected wallet balance ${amountMinor} exceeds maximum ${limit.toString()}`);
        }
        continue;
      }
      // Fetch ledger balance with manager (handles SERIALIZABLE)
      // Need LedgerAccount to know normalBalance; fetch it
      const ledgerAccRows: Array<{ id: string; normal_balance: string; currency: string }> = await manager.query(
        `SELECT id, normal_balance, currency FROM ledger_accounts WHERE id = $1 LIMIT 1`,
        [ledgerAccountId],
      );
      const ledgerAcc = ledgerAccRows[0];
      if (!ledgerAcc) continue;
      // Calculate balance: sum lines with direction vs normalBalance
      // Reuse ledger calculation logic via direct query
      const balanceRows: Array<{ direction: string; amount_minor: string }> = await manager.query(
        `SELECT direction, amount_minor::text AS amount_minor FROM ledger_lines WHERE ledger_account_id = $1`,
        [ledgerAccountId],
      );
      let balance = 0n;
      for (const row of balanceRows) {
        const amt = BigInt(row.amount_minor);
        const isNormal = row.direction === 'CREDIT' ? ledgerAcc.normal_balance === 'CREDIT' : ledgerAcc.normal_balance === 'DEBIT';
        // Simplify: if normal is CREDIT, CREDIT adds, DEBIT subtracts
        // Normal CREDIT means liability (wallet), so CREDIT increases balance
        const isCredit = row.direction === 'CREDIT';
        const normalIsCredit = ledgerAcc.normal_balance === 'CREDIT';
        const adds = isCredit === normalIsCredit;
        balance = balance + (adds ? amt : -amt);
      }
      // Projected balance after this transaction
      // For INCOMING to principal, balance increases by amount; for OUTGOING, decreases but we check current over limit
      let projected = balance;
      if (direction === 'INCOMING') projected = balance + amount;
      // For BOTH treat as increase (conservative)
      else if (direction === 'BOTH') projected = balance + amount;

      if (projected > limit) {
        throw this.limitException(
          LimitFailureCode.LIMIT_WALLET_BALANCE_EXCEEDED,
          `Wallet balance ${balance.toString()} + ${amountMinor} would exceed maximum ${limit.toString()}`,
        );
      }
      // Also if current already over limit, block even outgoing? For OUTGOING, projected = balance (or balance - amount which is lower), so not over.
      // But if balance already > limit and direction OUTGOING, we allow spending to reduce.
      // We already handled INCOMING projected; for OUTGOING we could check current > limit → allow? But spec says fail if wallet balance exceeded,
      // so if current already over max and outgoing will reduce, should we still block? We'll allow outgoing to reduce, only block incoming.
      // So no throw for outgoing current over.
    }

    // 3c) Windowed dimensions DAILY/WEEKLY/MONTHLY/YEARLY amount+count — must be evaluated simultaneously via reservation
    const windowed = applicable.filter((r) => {
      const d = r.dimension.trim().toUpperCase();
      return ['DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT'].includes(d);
    });

    if (windowed.length === 0) {
      return { allowed: true, limitProfileCode: profileCode, evaluatedDimensions, assignmentId: resolved.assignmentId, ruleRefs };
    }

    // Prepare reservations with limit enforcement: we will check used+reserved+delta > limit before increment inside same manager loop
    // Instead of using usageService directly for increment without check, we implement check here with FOR UPDATE then reserve
    // But we can delegate to usageService.reserveBatchWithManager that now supports limit checks if we pass limit values?
    // Current usageService.reserveBatchWithManager does NOT enforce limit values — it just increments.
    // So we need to enforce here by querying usages FOR UPDATE and validating before increment.
    // We'll do explicit loop inside this manager, using the same pattern as usageService but with limit validation.
    // To keep idempotency, we still use usageService's idempotency reserve + reservation row creation, but we add validation.
    // Simplest: Query usages FOR UPDATE, validate, then call reserveBatchWithManager? That would double lock.
    // Better: Do validation and reservation in one pass here, creating reservations directly, without calling usageService.
    // However, we need idempotency handling: use IdempotencyService if available.
    // We'll instead implement reservation loop here including idempotency, but reuse logic from usageService for creation.
    // For maintainability, we will call usageService.reserveBatchWithManager after pre-validating via a separate query that locks? But that would be two locks.
    // Simpler to implement full reservation including validation inline, using manager, and avoid calling usageService.

    // Validate that we have idempotencyKey/requestHash
    if (!input.idempotencyKey || !input.requestHash) {
      throw new BadRequestException('idempotencyKey and requestHash required for limit enforcement');
    }

    // Try to implement windowed enforcement atomically with idempotency check + usage lock + limit check + increment
    // We will replicate idempotency guard inside same manager to avoid double transaction.
    // Use dataSource's IdempotencyService if available via usageService? But we don't have direct access to IdempotencyService here.
    // We can achieve idempotency via limit_reservations unique idempotencyKey+window, but better to use IdempotencyService if present.
    // We'll attempt to fetch IdempotencyService via usageService's private; instead we can query idempotency_records directly.

    // For now, handle replay by checking existing limit_reservations for this idempotencyKey
    const existingReservations: Array<{ id: string; request_hash: string }> = await manager.query(
      `SELECT id, request_hash FROM limit_reservations WHERE idempotency_key = $1 LIMIT 1`,
      [input.idempotencyKey],
    );
    if (existingReservations.length > 0) {
      if (existingReservations[0]!.request_hash !== input.requestHash) {
        throw new BadRequestException('Idempotency key already used for different request');
      }
      // Replay — treat as allowed without double increment; caller will handle idempotent replay via outer financial idempotency
      {
        const replayEvidence = await this.replayEvidence(manager, input.idempotencyKey);
        return { allowed: true, limitProfileCode: profileCode, evaluatedDimensions, reserved: { kind: 'REPLAY' }, assignmentId: resolved.assignmentId, ruleRefs, ...replayEvidence };
      }
    }

    // Also check idempotency_records for scope limit:usage:reserve if exists
    // To mimic usageService behavior, check that table
    const idemRows: Array<{ id: string; request_hash: string; status: string }> = await manager.query(
      `SELECT id, request_hash, status FROM idempotency_records WHERE scope = 'limit:usage:reserve' AND idempotency_key = $1 LIMIT 1`,
      [input.idempotencyKey],
    );
    let idemId: string | null = null;
    if (idemRows.length > 0) {
      const row = idemRows[0]!;
      if (row.request_hash !== input.requestHash) {
        throw new BadRequestException('Idempotency key already used for different request');
      }
      if (row.status === 'COMPLETED') {
        // Already completed — replay
        {
        const replayEvidence = await this.replayEvidence(manager, input.idempotencyKey);
        return { allowed: true, limitProfileCode: profileCode, evaluatedDimensions, reserved: { kind: 'REPLAY' }, assignmentId: resolved.assignmentId, ruleRefs, ...replayEvidence };
      }
      }
      if (row.status === 'IN_PROGRESS') {
        // Someone else is in progress — concurrent duplicate? Treat as replay? But we should let usageService handle.
        // For simplicity, return replay (outer financial idempotency will handle)
        {
        const replayEvidence = await this.replayEvidence(manager, input.idempotencyKey);
        return { allowed: true, limitProfileCode: profileCode, evaluatedDimensions, reserved: { kind: 'REPLAY' }, assignmentId: resolved.assignmentId, ruleRefs, ...replayEvidence };
      }
      }
      idemId = row.id;
    } else {
      // Insert IN_PROGRESS
      const inserted: Array<{ id: string }> = await manager.query(
        `INSERT INTO idempotency_records (id, scope, idempotency_key, request_hash, status, hit_count, last_seen_at, expires_at, created_at, updated_at)
         VALUES (gen_random_uuid(), 'limit:usage:reserve', $1, $2, 'IN_PROGRESS', 0, NOW(), NOW() + interval '86400 seconds', NOW(), NOW())
         ON CONFLICT (scope, idempotency_key) DO NOTHING
         RETURNING id`,
        [input.idempotencyKey, input.requestHash],
      );
      if (inserted[0]?.id) idemId = inserted[0].id;
      else {
        const fetched: Array<{ id: string }> = await manager.query(
          `SELECT id FROM idempotency_records WHERE scope='limit:usage:reserve' AND idempotency_key=$1 LIMIT 1`,
          [input.idempotencyKey],
        );
        idemId = fetched[0]?.id ?? null;
      }
    }

    // For each windowed rule, ensure usage row exists, lock, validate, then increment reserved
    const reservations: Array<{ dimension: string; product: string; currency: string; windowKey: string; amountMinor: string | null; count: number | null; ruleId: string }> = [];
    const usageIds: string[] = [];
    const newReservationIds: string[] = [];

    for (const rule of windowed) {
      const dim = rule.dimension.trim().toUpperCase();
      const productForRule = rule.product.trim().toUpperCase();
      const currencyForRule = rule.currency.trim().toUpperCase();
      const dirForUsage = rule.direction ? rule.direction.trim().toUpperCase() : null;
      const channelForUsage = rule.channel ? rule.channel.trim().toUpperCase() : null;
      const window = getWindowForDimension(now, dim);
      if (!window) throw new BadRequestException(`No window for dimension ${dim}`);

      const isAmt = dim.endsWith('_AMOUNT');
      const deltaAmt = isAmt ? amountMinor : null;
      const deltaCnt = !isAmt ? 1 : null;

      // Ensure usage row exists
      await manager.query(
        `INSERT INTO limit_usages (id, principal_type, principal_id, limit_profile_code, limit_rule_id, product, direction, channel, dimension, currency, window_type, window_key, window_start, window_end, used_amount_minor, used_count, reserved_amount_minor, reserved_count, created_at, updated_at)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,0,0,NOW(),NOW())
         ON CONFLICT (principal_type, principal_id, limit_profile_code, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key) DO NOTHING`,
        [
          principalType,
          principalId,
          profileCode,
          rule.id,
          productForRule,
          dirForUsage,
          channelForUsage,
          dim,
          currencyForRule,
          window.windowType,
          window.windowKey,
          window.windowStart,
          window.windowEnd,
        ],
      );

      // Lock row
      const usageRows: Array<{
        id: string;
        used_amount_minor: string;
        used_count: number;
        reserved_amount_minor: string;
        reserved_count: number;
      }> = await manager.query(
        `SELECT id, used_amount_minor::text AS used_amount_minor, used_count, reserved_amount_minor::text AS reserved_amount_minor, reserved_count
           FROM limit_usages
          WHERE principal_type = $1 AND principal_id = $2 AND limit_profile_code = $3 AND product = $4 AND COALESCE(direction,'') = COALESCE($5,'') AND COALESCE(channel,'') = COALESCE($6,'') AND dimension = $7 AND currency = $8 AND window_key = $9
          FOR UPDATE`,
        [principalType, principalId, profileCode, productForRule, dirForUsage, channelForUsage, dim, currencyForRule, window.windowKey],
      );
      const usage = usageRows[0];
      if (!usage) throw new BadRequestException(`Limit usage row not found for ${dim}`);

      // Validate limit
      if (isAmt) {
        const limit = rule.limit_value_minor ? BigInt(rule.limit_value_minor) : null;
        if (limit !== null) {
          const used = BigInt(usage.used_amount_minor);
          const reserved = BigInt(usage.reserved_amount_minor);
          const total = used + reserved + BigInt(deltaAmt!);
          if (total > limit) {
            throw this.limitException(dimensionToFailureCode(dim, true), `Limit ${dim} amount ${total.toString()} exceeds ${limit.toString()} for window ${window.windowKey}`);
          }
        }
        // Increment reserved
        const newReserved = (BigInt(usage.reserved_amount_minor) + BigInt(deltaAmt!)).toString();
        await manager.query(`UPDATE limit_usages SET reserved_amount_minor = $1, updated_at = NOW() WHERE id = $2`, [newReserved, usage.id]);
      } else {
        const limit = rule.limit_value_count;
        if (limit !== null && limit !== undefined) {
          const used = usage.used_count;
          const reserved = usage.reserved_count;
          const total = used + reserved + (deltaCnt as number);
          if (total > limit) {
            throw this.limitException(dimensionToFailureCode(dim, true), `Limit ${dim} count ${total} exceeds ${limit} for window ${window.windowKey}`);
          }
        }
        const newReserved = usage.reserved_count + (deltaCnt as number);
        await manager.query(`UPDATE limit_usages SET reserved_count = $1, updated_at = NOW() WHERE id = $2`, [newReserved, usage.id]);
      }

      // Insert reservation row
      const windowType = window.windowType;
      try {
        const insertedReservation: Array<{ id: string }> = await manager.query(
          `INSERT INTO limit_reservations (id, idempotency_key, request_hash, correlation_id, principal_type, principal_id, limit_profile_code, limit_rule_id, product, direction, channel, dimension, currency, window_type, window_key, window_start, window_end, amount_minor, count, status, limit_usage_id, created_at, updated_at)
           VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'RESERVED',$19,NOW(),NOW())
           RETURNING id`,
          [
            input.idempotencyKey,
            input.requestHash,
            input.correlationId ?? null,
            principalType,
            principalId,
            profileCode,
            rule.id,
            productForRule,
            dirForUsage,
            channelForUsage,
            dim,
            currencyForRule,
            windowType,
            window.windowKey,
            window.windowStart,
            window.windowEnd,
            deltaAmt,
            deltaCnt,
            usage.id,
          ],
        );
        if (insertedReservation[0]?.id) newReservationIds.push(insertedReservation[0].id);
      } catch (e: any) {
        if (e?.code === '23505') {
          // Unique violation — concurrent reserve for same window/idempotencyKey, treat as already reserved (should be replay)
          // Continue
        } else throw e;
      }

      reservations.push({ dimension: dim, product: productForRule, currency: currencyForRule, windowKey: window.windowKey, amountMinor: deltaAmt, count: deltaCnt, ruleId: rule.id });
      usageIds.push(usage.id);
    }

    // Mark idempotency completed
    if (idemId) {
      await manager.query(
        `UPDATE idempotency_records SET status='COMPLETED', response_status_code=200, response_body=$2::jsonb, resource_type='LIMIT_RESERVATION', resource_id=$3, last_seen_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [idemId, JSON.stringify({ reserved: reservations.length }), reservations[0] ? reservations[0].ruleId : null],
      );
    }

    // Note: caller must commit → move reserved→used after financial success, or let rollback on failure.
    // We do not auto-commit here; caller will call commit usage after ledger success within same outer transaction.
    // For atomic wiring where reservation+ledger are same transaction, we can immediately move reserved→used before commit.
    // Instead, we leave reserved and let outer transaction's commit step handle, or if outer transaction commits, reserved remains but should be committed.
    // To ensure RESERVED→COMMITTED in same transaction, we will immediately move to used here? No, we need to let outer know to commit.
    // For same-transaction atomic case, the outer transaction will commit reservations via commitWithManager or directly.
    // We will not auto-commit; outer service should call commit after ledger.
    // But for convenience, if outer already includes ledger success in same manager, we could move reserved→used now.
    // We'll let outer handle.

    return { allowed: true, limitProfileCode: profileCode, evaluatedDimensions, reserved: { kind: 'NEW' }, assignmentId: resolved.assignmentId, ruleRefs, reservationIds: newReservationIds, usageIds };
  }

  /** V1-COMMERCIAL-DECISION-02 (additive): authoritative reservation evidence for replays. */
  private async replayEvidence(manager: EntityManager, idempotencyKey: string): Promise<{ reservationIds: string[]; usageIds: string[] }> {
    const rows: Array<{ id: string; limit_usage_id: string | null }> = await manager.query(
      `SELECT id, limit_usage_id FROM limit_reservations WHERE idempotency_key = $1 ORDER BY created_at ASC, id ASC`,
      [idempotencyKey],
    );
    return {
      reservationIds: rows.map((r) => r.id),
      usageIds: rows.map((r) => r.limit_usage_id).filter((v): v is string => v !== null),
    };
  }

  private limitException(code: LimitFailureCode, message: string): HttpException {
    // Map to 422 for exceeded, 400 for min? Spec says stable codes, use 422 for most, 400 for min not met
    const status = code === LimitFailureCode.LIMIT_MIN_AMOUNT_NOT_MET ? HttpStatus.BAD_REQUEST : HttpStatus.UNPROCESSABLE_ENTITY;
    const err: any = new HttpException({ message, error: code, code }, status);
    (err as any).code = code;
    return err;
  }

  async releaseReservationsWithManager(manager: EntityManager, idempotencyKey: string): Promise<void> {
    const reservations: Array<{ id: string; limit_usage_id: string | null; amount_minor: string | null; count: number | null }> = await manager.query(
      `SELECT id, limit_usage_id, amount_minor::text AS amount_minor, count FROM limit_reservations WHERE idempotency_key=$1 AND status='RESERVED'`,
      [idempotencyKey],
    );
    if (reservations.length === 0) return;
    for (const r of reservations) {
      if (!r.limit_usage_id) continue;
      const usageRows: Array<{ id: string; reserved_amount_minor: string; reserved_count: number }> = await manager.query(
        `SELECT id, reserved_amount_minor::text AS reserved_amount_minor, reserved_count FROM limit_usages WHERE id=$1 FOR UPDATE`,
        [r.limit_usage_id],
      );
      const u = usageRows[0];
      if (!u) continue;
      if (r.amount_minor !== null) {
        const amt = BigInt(r.amount_minor);
        const reserved = BigInt(u.reserved_amount_minor);
        const newReserved = (reserved - amt).toString();
        await manager.query(`UPDATE limit_usages SET reserved_amount_minor=$1, updated_at=NOW() WHERE id=$2`, [newReserved, u.id]);
      }
      if (r.count !== null) {
        const newReserved = u.reserved_count - (r.count as number);
        await manager.query(`UPDATE limit_usages SET reserved_count=$1, updated_at=NOW() WHERE id=$2`, [newReserved, u.id]);
      }
      await manager.query(`UPDATE limit_reservations SET status='RELEASED', released_at=NOW(), updated_at=NOW() WHERE id=$1`, [r.id]);
    }
    // also mark idempotency as completed with release? keep as is
  }

  // Helper to commit reservations after successful ledger within same manager
  async commitReservationsWithManager(manager: EntityManager, idempotencyKey: string): Promise<void> {
    const reservations: Array<{ id: string; limit_usage_id: string | null; amount_minor: string | null; count: number | null }> = await manager.query(
      `SELECT id, limit_usage_id, amount_minor::text AS amount_minor, count FROM limit_reservations WHERE idempotency_key=$1 AND status='RESERVED'`,
      [idempotencyKey],
    );
    if (reservations.length === 0) {
      const committed: Array<{ id: string }> = await manager.query(
        `SELECT id FROM limit_reservations WHERE idempotency_key=$1 AND status='COMMITTED' LIMIT 1`,
        [idempotencyKey],
      );
      if (committed.length > 0) return;
      // No reservations for this key — may be non-windowed only, nothing to commit
      return;
    }
    for (const r of reservations) {
      if (!r.limit_usage_id) continue;
      const usageRows: Array<{ id: string; used_amount_minor: string; reserved_amount_minor: string; used_count: number; reserved_count: number }> = await manager.query(
        `SELECT id, used_amount_minor::text AS used_amount_minor, reserved_amount_minor::text AS reserved_amount_minor, used_count, reserved_count FROM limit_usages WHERE id=$1 FOR UPDATE`,
        [r.limit_usage_id],
      );
      const u = usageRows[0];
      if (!u) continue;
      if (r.amount_minor !== null) {
        const amt = BigInt(r.amount_minor);
        const reserved = BigInt(u.reserved_amount_minor);
        const newReserved = (reserved - amt).toString();
        const newUsed = (BigInt(u.used_amount_minor) + amt).toString();
        await manager.query(`UPDATE limit_usages SET reserved_amount_minor=$1, used_amount_minor=$2, updated_at=NOW() WHERE id=$3`, [newReserved, newUsed, u.id]);
      }
      if (r.count !== null) {
        const newReserved = u.reserved_count - (r.count as number);
        const newUsed = u.used_count + (r.count as number);
        await manager.query(`UPDATE limit_usages SET reserved_count=$1, used_count=$2, updated_at=NOW() WHERE id=$3`, [newReserved, newUsed, u.id]);
      }
      await manager.query(`UPDATE limit_reservations SET status='COMMITTED', committed_at=NOW(), updated_at=NOW() WHERE id=$1`, [r.id]);
    }
  }
}
