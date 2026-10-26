import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { IdempotencyRecord } from '../operations/idempotency-record.entity';
import { IdempotencyService } from '../operations/idempotency.service';
import { LimitReservation, LimitReservationStatus } from './limit-reservation.entity';
import { LimitUsage } from './limit-usage.entity';
import { getLagosWindow, getWindowForDimension, isWindowedDimension, LimitWindowType } from './limit-window.util';

const AMOUNT_DIMENSIONS = new Set(['DAILY_AMOUNT', 'WEEKLY_AMOUNT', 'MONTHLY_AMOUNT', 'YEARLY_AMOUNT', 'MIN_AMOUNT_PER_TX', 'MAX_AMOUNT_PER_TX', 'WALLET_BALANCE_MAX']);
const COUNT_DIMENSIONS = new Set(['DAILY_COUNT', 'WEEKLY_COUNT', 'MONTHLY_COUNT', 'YEARLY_COUNT']);
const WINDOWED_DIMENSIONS = new Set(['DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT']);

function isAmountDimension(dim: string): boolean {
  return AMOUNT_DIMENSIONS.has(dim.toUpperCase());
}
function isCountDimension(dim: string): boolean {
  return COUNT_DIMENSIONS.has(dim.toUpperCase());
}
function isWindowed(dim: string): boolean {
  return WINDOWED_DIMENSIONS.has(dim.toUpperCase());
}

export interface LimitUsageReserveEntry {
  dimension: string;
  product: string;
  currency: string;
  amountMinor?: string | null;
  count?: number | null;
  limitRuleId?: string | null;
  direction?: string | null;
  channel?: string | null;
}

export interface LimitUsageReserveBatchInput {
  principalType: string;
  principalId: string;
  limitProfileCode: string;
  product?: string; // fallback if entry product not specified
  currency?: string;
  direction?: string | null;
  channel?: string | null;
  reservations: LimitUsageReserveEntry[];
  idempotencyKey: string;
  requestHash: string;
  correlationId?: string | null;
  now?: Date;
}

export interface LimitUsageCommitInput {
  idempotencyKey: string;
}

@Injectable()
export class LimitUsageService {
  constructor(
    @InjectRepository(LimitUsage)
    private readonly usageRepo: Repository<LimitUsage>,
    @InjectRepository(LimitReservation)
    private readonly reservationRepo: Repository<LimitReservation>,
    private readonly dataSource: DataSource,
    @Optional() private readonly idempotencyService?: IdempotencyService,
  ) {}

  // ── Window helpers exposed for tests ──
  getLagosWindow(now: Date, windowType: LimitWindowType) {
    return getLagosWindow(now, windowType);
  }

  dimensionToWindowType(dimension: string) {
    return getWindowForDimension(new Date(), dimension)?.windowType ?? null;
  }

  // ── Reservation batch with manager (for atomic financial flows) ──
  async reserveBatchWithManager(
    manager: EntityManager,
    input: LimitUsageReserveBatchInput,
  ): Promise<{ kind: 'NEW' | 'REPLAY'; reservations: LimitReservation[]; usages: LimitUsage[] }> {
    this.validateReserveBatch(input);
    const now = input.now ?? new Date();
    const scope = 'limit:usage:reserve';
    // Idempotency guard — must be inside transaction before usage consumption
    if (this.idempotencyService) {
      const idem = await this.idempotencyService.reserve(manager, {
        scope,
        key: input.idempotencyKey,
        requestHash: input.requestHash,
      } as never);
      if ((idem as any).kind === 'REPLAY') {
        const existingReservations: LimitReservation[] = await manager
          .getRepository(LimitReservation)
          .find({ where: { idempotencyKey: input.idempotencyKey } as never });
        const usageIds = existingReservations.map((r) => r.limitUsageId).filter(Boolean) as string[];
        const usages: LimitUsage[] = usageIds.length
          ? await manager.getRepository(LimitUsage).createQueryBuilder('u').where('u.id IN (:...ids)', { ids: usageIds }).getMany()
          : [];
        return { kind: 'REPLAY' as const, reservations: existingReservations, usages };
      }
    } else {
      const existing = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey } as never });
      if (existing.length > 0) {
        if (existing[0]!.requestHash !== input.requestHash) {
          throw new ConflictException('The idempotency key was already used for another request');
        }
        const usageIds = existing.map((r) => r.limitUsageId).filter(Boolean) as string[];
        const usages: LimitUsage[] = usageIds.length
          ? await manager.getRepository(LimitUsage).createQueryBuilder('u').where('u.id IN (:...ids)', { ids: usageIds }).getMany()
          : [];
        return { kind: 'REPLAY' as const, reservations: existing, usages };
      }
    }

    const reservations: LimitReservation[] = [];
    const usages: LimitUsage[] = [];

    for (const entry of input.reservations) {
      const dimension = entry.dimension.trim().toUpperCase();
      if (!isWindowed(dimension)) {
        throw new BadRequestException(`dimension ${dimension} is not a windowed dimension (DAILY/WEEKLY/MONTHLY/YEARLY amount/count only)`);
      }
      const isAmt = dimension.endsWith('_AMOUNT');
      const isCnt = dimension.endsWith('_COUNT');
      if (isAmt) {
        if (entry.amountMinor === undefined || entry.amountMinor === null) throw new BadRequestException(`amountMinor required for ${dimension}`);
        if (!/^\d+$/.test(String(entry.amountMinor))) throw new BadRequestException(`amountMinor must be numeric string for ${dimension}`);
        if (entry.count !== undefined && entry.count !== null) throw new BadRequestException(`count must be null for amount dimension ${dimension}`);
      } else if (isCnt) {
        if (entry.count === undefined || entry.count === null) throw new BadRequestException(`count required for ${dimension}`);
        if (!Number.isSafeInteger(entry.count) || entry.count < 0) throw new BadRequestException(`count must be integer >=0 for ${dimension}`);
        if (entry.amountMinor !== undefined && entry.amountMinor !== null) throw new BadRequestException(`amountMinor must be null for count dimension ${dimension}`);
      }

      const product = (entry.product ?? input.product ?? '').trim();
      if (!product) throw new BadRequestException('product is required');
      const currency = (entry.currency ?? input.currency ?? 'NGN').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('currency must be 3-letter');

      const direction = entry.direction ?? input.direction ?? null;
      const channel = entry.channel ?? input.channel ?? null;

      const window = getWindowForDimension(now, dimension);
      if (!window) throw new BadRequestException(`No window for dimension ${dimension}`);

      const limitProfileCode = input.limitProfileCode.trim().toUpperCase();
      const principalType = input.principalType.trim().toUpperCase();
      const principalId = input.principalId.trim();

      await manager.query(
        `INSERT INTO limit_usages (principal_type, principal_id, limit_profile_code, limit_rule_id, product, direction, channel, dimension, currency, window_type, window_key, window_start, window_end, used_amount_minor, used_count, reserved_amount_minor, reserved_count)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,0,0)
               ON CONFLICT (principal_type, principal_id, limit_profile_code, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key) DO NOTHING`,
        [
          principalType,
          principalId,
          limitProfileCode,
          entry.limitRuleId ?? null,
          product,
          direction,
          channel,
          dimension,
          currency,
          window.windowType,
          window.windowKey,
          window.windowStart,
          window.windowEnd,
        ],
      );

      const usage: LimitUsage | null = await manager
        .getRepository(LimitUsage)
        .createQueryBuilder('u')
        .where(
          'u.principalType = :pt AND u.principalId = :pid AND u.limitProfileCode = :code AND u.product = :product AND COALESCE(u.direction,\'\') = COALESCE(:direction,\'\') AND COALESCE(u.channel,\'\') = COALESCE(:channel,\'\') AND u.dimension = :dim AND u.currency = :curr AND u.windowKey = :key',
          {
            pt: principalType,
            pid: principalId,
            code: limitProfileCode,
            product,
            direction,
            channel,
            dim: dimension,
            curr: currency,
            key: window.windowKey,
          },
        )
        .setLock('pessimistic_write')
        .getOne();

      if (!usage) throw new ConflictException('Limit usage row not found after insert');

      if (isAmt) {
        const amt = BigInt(entry.amountMinor as string);
        const current = BigInt(usage.reservedAmountMinor);
        usage.reservedAmountMinor = (current + amt).toString();
      } else {
        usage.reservedCount = usage.reservedCount + (entry.count as number);
      }

      await manager.getRepository(LimitUsage).save(usage);
      usages.push(usage);

      const reservation = manager.getRepository(LimitReservation).create({
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        correlationId: input.correlationId ?? null,
        principalType,
        principalId,
        limitProfileCode,
        limitRuleId: entry.limitRuleId ?? null,
        product,
        direction,
        channel,
        dimension,
        currency,
        windowType: window.windowType,
        windowKey: window.windowKey,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        amountMinor: isAmt ? (entry.amountMinor as string) : null,
        count: isCnt ? (entry.count as number) : null,
        status: LimitReservationStatus.RESERVED,
        limitUsageId: usage.id,
      } as never);

      try {
        const saved = await manager.getRepository(LimitReservation).save(reservation as never);
        reservations.push(saved as unknown as LimitReservation);
      } catch (e) {
        if (e instanceof QueryFailedError && (e as any).code === '23505') {
          throw new ConflictException('Reservation already exists for this idempotency key and window');
        }
        throw e;
      }
    }

    if (this.idempotencyService) {
      const rec = await manager.getRepository(IdempotencyRecord).findOne({ where: { scope, idempotencyKey: input.idempotencyKey } as never });
      if (rec) {
        const firstReservationId = reservations[0]?.id ?? null;
        await this.idempotencyService.complete(manager, (rec as any).id, { statusCode: 200, responseBody: { reserved: reservations.length }, resourceType: 'LIMIT_RESERVATION', resourceId: firstReservationId } as never);
      }
    }

    return { kind: 'NEW' as const, reservations, usages };
  }

  async commitWithManager(manager: EntityManager, input: LimitUsageCommitInput): Promise<{ committed: number; reservations: LimitReservation[] }> {
    const reservations: LimitReservation[] = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey, status: LimitReservationStatus.RESERVED } as never });
    if (reservations.length === 0) {
      const already: LimitReservation[] = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey, status: LimitReservationStatus.COMMITTED } as never });
      if (already.length > 0) return { committed: 0, reservations: already };
      throw new NotFoundException(`No RESERVED reservations for idempotencyKey ${input.idempotencyKey}`);
    }
    for (const r of reservations) {
      if (!r.limitUsageId) continue;
      const usage: LimitUsage | null = await manager
        .getRepository(LimitUsage)
        .createQueryBuilder('u')
        .where('u.id = :id', { id: r.limitUsageId })
        .setLock('pessimistic_write')
        .getOne();
      if (!usage) throw new NotFoundException(`Usage ${r.limitUsageId} not found`);
      if (r.amountMinor !== null && r.amountMinor !== undefined) {
        const amt = BigInt(r.amountMinor);
        const reserved = BigInt(usage.reservedAmountMinor);
        if (reserved < amt) throw new ConflictException('Reserved amount underflow on commit');
        usage.reservedAmountMinor = (reserved - amt).toString();
        usage.usedAmountMinor = (BigInt(usage.usedAmountMinor) + amt).toString();
      }
      if (r.count !== null && r.count !== undefined) {
        if (usage.reservedCount < (r.count as number)) throw new ConflictException('Reserved count underflow on commit');
        usage.reservedCount = usage.reservedCount - (r.count as number);
        usage.usedCount = usage.usedCount + (r.count as number);
      }
      await manager.getRepository(LimitUsage).save(usage);
      (r as any).status = LimitReservationStatus.COMMITTED;
      (r as any).committedAt = new Date();
      await manager.getRepository(LimitReservation).save(r as never);
    }
    const updated = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey } as never });
    return { committed: reservations.length, reservations: updated };
  }

  async releaseWithManager(manager: EntityManager, input: LimitUsageCommitInput): Promise<{ released: number; reservations: LimitReservation[] }> {
    const reservations: LimitReservation[] = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey, status: LimitReservationStatus.RESERVED } as never });
    if (reservations.length === 0) {
      const already: LimitReservation[] = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey, status: LimitReservationStatus.RELEASED } as never });
      if (already.length > 0) return { released: 0, reservations: already };
      throw new NotFoundException(`No RESERVED reservations for idempotencyKey ${input.idempotencyKey}`);
    }
    for (const r of reservations) {
      if (!r.limitUsageId) continue;
      const usage: LimitUsage | null = await manager
        .getRepository(LimitUsage)
        .createQueryBuilder('u')
        .where('u.id = :id', { id: r.limitUsageId })
        .setLock('pessimistic_write')
        .getOne();
      if (!usage) throw new NotFoundException(`Usage ${r.limitUsageId} not found`);
      if (r.amountMinor !== null && r.amountMinor !== undefined) {
        const amt = BigInt(r.amountMinor);
        const reserved = BigInt(usage.reservedAmountMinor);
        if (reserved < amt) throw new ConflictException('Reserved amount underflow on release');
        usage.reservedAmountMinor = (reserved - amt).toString();
      }
      if (r.count !== null && r.count !== undefined) {
        if (usage.reservedCount < (r.count as number)) throw new ConflictException('Reserved count underflow on release');
        usage.reservedCount = usage.reservedCount - (r.count as number);
      }
      await manager.getRepository(LimitUsage).save(usage);
      (r as any).status = LimitReservationStatus.RELEASED;
      (r as any).releasedAt = new Date();
      await manager.getRepository(LimitReservation).save(r as never);
    }
    const updated = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey } as never });
    return { released: reservations.length, reservations: updated };
  }

  // ── Reservation batch ──
  async reserveBatch(input: LimitUsageReserveBatchInput): Promise<{ kind: 'NEW' | 'REPLAY'; reservations: LimitReservation[]; usages: LimitUsage[] }> {
    this.validateReserveBatch(input);
    // Retry loop for SERIALIZABLE — high contention (10 concurrent) needs many attempts
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const result = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          return this.reserveBatchWithManager(manager, input);
        });
        return result as { kind: 'NEW' | 'REPLAY'; reservations: LimitReservation[]; usages: LimitUsage[] };
      } catch (e) {
        if (this.isRetryable(e)) {
          if (attempt < 9) {
            await new Promise((res) => setTimeout(res, 20 * (attempt + 1) + Math.floor(Math.random() * 20)));
            continue;
          }
          throw this.transactionContentionExhaustedException('Could not reserve limit usage after retries');
        }
        throw e;
      }
    }
    throw this.transactionContentionExhaustedException('Could not reserve limit usage after retries');
  }
  // Single reservation convenience
  async reserve(input: {
    principalType: string;
    principalId: string;
    limitProfileCode: string;
    product: string;
    dimension: string;
    currency: string;
    amountMinor?: string | null;
    count?: number | null;
    limitRuleId?: string | null;
    direction?: string | null;
    channel?: string | null;
    idempotencyKey: string;
    requestHash: string;
    correlationId?: string | null;
    now?: Date;
  }): Promise<{ kind: 'NEW' | 'REPLAY'; reservation: LimitReservation; usage: LimitUsage }> {
    const result = await this.reserveBatch({
      principalType: input.principalType,
      principalId: input.principalId,
      limitProfileCode: input.limitProfileCode,
      product: input.product,
      currency: input.currency,
      direction: input.direction,
      channel: input.channel,
      reservations: [
        {
          dimension: input.dimension,
          product: input.product,
          currency: input.currency,
          amountMinor: input.amountMinor,
          count: input.count,
          limitRuleId: input.limitRuleId,
          direction: input.direction,
          channel: input.channel,
        },
      ],
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      correlationId: input.correlationId,
      now: input.now,
    });
    return { kind: result.kind, reservation: result.reservations[0]!, usage: result.usages[0]! };
  }

  async commit(input: LimitUsageCommitInput): Promise<{ committed: number; reservations: LimitReservation[] }> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const reservations: LimitReservation[] = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey, status: LimitReservationStatus.RESERVED } as never });
          if (reservations.length === 0) {
            const already: LimitReservation[] = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey, status: LimitReservationStatus.COMMITTED } as never });
            if (already.length > 0) return { committed: 0, reservations: already };
            throw new NotFoundException(`No RESERVED reservations for idempotencyKey ${input.idempotencyKey}`);
          }
          for (const r of reservations) {
            if (!r.limitUsageId) continue;
            const usage: LimitUsage | null = await manager
              .getRepository(LimitUsage)
              .createQueryBuilder('u')
              .where('u.id = :id', { id: r.limitUsageId })
              .setLock('pessimistic_write')
              .getOne();
            if (!usage) throw new NotFoundException(`Usage ${r.limitUsageId} not found`);
            // Move reserved -> used
            if (r.amountMinor !== null && r.amountMinor !== undefined) {
              const amt = BigInt(r.amountMinor);
              const reserved = BigInt(usage.reservedAmountMinor);
              if (reserved < amt) throw new ConflictException('Reserved amount underflow on commit');
              usage.reservedAmountMinor = (reserved - amt).toString();
              usage.usedAmountMinor = (BigInt(usage.usedAmountMinor) + amt).toString();
            }
            if (r.count !== null && r.count !== undefined) {
              if (usage.reservedCount < (r.count as number)) throw new ConflictException('Reserved count underflow on commit');
              usage.reservedCount = usage.reservedCount - (r.count as number);
              usage.usedCount = usage.usedCount + (r.count as number);
            }
            await manager.getRepository(LimitUsage).save(usage);
            (r as any).status = LimitReservationStatus.COMMITTED;
            (r as any).committedAt = new Date();
            await manager.getRepository(LimitReservation).save(r as never);
          }
          const updated = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey } as never });
          return { committed: reservations.length, reservations: updated };
        });
      } catch (e) {
        if (this.isRetryable(e)) {
          if (attempt < 9) {
            await new Promise((res) => setTimeout(res, 20 * (attempt + 1) + Math.floor(Math.random() * 20)));
            continue;
          }
          throw this.transactionContentionExhaustedException('Could not commit after retries');
        }
        throw e;
      }
    }
    throw this.transactionContentionExhaustedException('Could not commit after retries');
  }

  async release(input: LimitUsageCommitInput): Promise<{ released: number; reservations: LimitReservation[] }> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const reservations: LimitReservation[] = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey, status: LimitReservationStatus.RESERVED } as never });
          if (reservations.length === 0) {
            const already: LimitReservation[] = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey, status: LimitReservationStatus.RELEASED } as never });
            if (already.length > 0) return { released: 0, reservations: already };
            throw new NotFoundException(`No RESERVED reservations for idempotencyKey ${input.idempotencyKey}`);
          }
          for (const r of reservations) {
            if (!r.limitUsageId) continue;
            const usage: LimitUsage | null = await manager
              .getRepository(LimitUsage)
              .createQueryBuilder('u')
              .where('u.id = :id', { id: r.limitUsageId })
              .setLock('pessimistic_write')
              .getOne();
            if (!usage) throw new NotFoundException(`Usage ${r.limitUsageId} not found`);
            if (r.amountMinor !== null && r.amountMinor !== undefined) {
              const amt = BigInt(r.amountMinor);
              const reserved = BigInt(usage.reservedAmountMinor);
              if (reserved < amt) throw new ConflictException('Reserved amount underflow on release');
              usage.reservedAmountMinor = (reserved - amt).toString();
            }
            if (r.count !== null && r.count !== undefined) {
              if (usage.reservedCount < (r.count as number)) throw new ConflictException('Reserved count underflow on release');
              usage.reservedCount = usage.reservedCount - (r.count as number);
            }
            await manager.getRepository(LimitUsage).save(usage);
            (r as any).status = LimitReservationStatus.RELEASED;
            (r as any).releasedAt = new Date();
            await manager.getRepository(LimitReservation).save(r as never);
          }
          const updated = await manager.getRepository(LimitReservation).find({ where: { idempotencyKey: input.idempotencyKey } as never });
          return { released: reservations.length, reservations: updated };
        });
      } catch (e) {
        if (this.isRetryable(e)) {
          if (attempt < 9) {
            await new Promise((res) => setTimeout(res, 20 * (attempt + 1) + Math.floor(Math.random() * 20)));
            continue;
          }
          throw this.transactionContentionExhaustedException('Could not release after retries');
        }
        throw e;
      }
    }
    throw this.transactionContentionExhaustedException('Could not release after retries');
  }

  async getUsage(params: {
    principalType: string;
    principalId: string;
    limitProfileCode: string;
    product: string;
    dimension: string;
    currency: string;
    windowKey: string;
  }): Promise<LimitUsage | null> {
    return this.usageRepo.findOne({ where: params as never });
  }

  async listUsages(filter: Partial<LimitUsage> & { principalType?: string; principalId?: string }): Promise<LimitUsage[]> {
    return this.usageRepo.find({ where: filter as never, order: { windowStart: 'ASC' } as never });
  }

  private validateReserveBatch(input: LimitUsageReserveBatchInput): void {
    if (!input.principalType || !/^(CUSTOMER|AGENT|AGENT_CLASS|SEGMENT|GLOBAL)$/i.test(input.principalType.trim())) throw new BadRequestException('principalType must be CUSTOMER|AGENT|AGENT_CLASS|SEGMENT|GLOBAL');
    if (!input.principalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.principalId.trim())) throw new BadRequestException('principalId must be UUID');
    if (!input.limitProfileCode || !/^[A-Z0-9_]{3,80}$/.test(input.limitProfileCode.trim().toUpperCase())) throw new BadRequestException('limitProfileCode must match ^[A-Z0-9_]{3,80}$');
    if (!input.idempotencyKey || input.idempotencyKey.length === 0 || input.idempotencyKey.length > 255) throw new BadRequestException('idempotencyKey required 1..255');
    if (!input.requestHash || !/^[a-f0-9]{64}$/i.test(input.requestHash)) throw new BadRequestException('requestHash must be 64 hex');
    if (!Array.isArray(input.reservations) || input.reservations.length === 0) throw new BadRequestException('reservations array required');
    for (const r of input.reservations) {
      if (!r.dimension || !/^[A-Z0-9_]{3,40}$/.test(r.dimension.trim().toUpperCase())) throw new BadRequestException('dimension required');
      if (!WINDOWED_DIMENSIONS.has(r.dimension.trim().toUpperCase())) throw new BadRequestException(`dimension ${r.dimension} must be windowed DAILY/WEEKLY/MONTHLY/YEARLY amount/count`);
    }
  }

  // V1-INFRA-03: mirrors the established house convention in
  // AgentCashToCashService.transactionContentionExhaustedException() — a stable, documented
  // machine code (`TRANSACTION_CONTENTION_RETRY_EXHAUSTED`) set as both `error` and `code` in
  // the response body, plus `.code` directly on the exception instance, so a caller never has
  // to parse a free-text message to recognize "safe to retry the whole request".
  private transactionContentionExhaustedException(message: string): ConflictException {
    const code = 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED';
    const exception = new ConflictException({ message, error: code, code });
    (exception as unknown as { code?: string }).code = code;
    return exception;
  }

  private isRetryable(error: unknown): boolean {
    const qe = error as any;
    const code = qe?.code ?? qe?.driverError?.code ?? null;
    const msg: string = (qe?.message ?? '') as string;
    const isSer = code === '40001' || code === '40P01' || msg.includes('could not serialize') || msg.includes('deadlock detected') || msg.includes('concurrent update');
    if (error instanceof QueryFailedError) return isSer;
    // also treat generic errors with serialization message as retryable
    return isSer;
  }
}
