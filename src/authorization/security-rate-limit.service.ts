import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../operations/audit.service';
import { runSerializableWithRetry } from '../common/serializable-transaction';
import { A2SecurityRateBucket } from './workforce-authentication.entity';
import type { A2RateLimitRuleV1 } from './workforce-authentication.types';
@Injectable()
export class A2SecurityRateLimitService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}
  async consume(
    rule: A2RateLimitRuleV1,
    dimensions: readonly string[],
    correlationId: string,
    now = new Date(),
  ) {
    this.validate(rule);
    if (!rule.enabled) return;
    const bucketKey = createHash('sha256')
      .update([rule.category, ...dimensions].join('\0'))
      .digest('hex');
    try {
      // V1-HARDEN-01: this bucket update runs under SERIALIZABLE isolation precisely
      // because it is a hot, shared row under concurrent load (the whole point of a rate
      // limiter is that many requests legitimately land on the same bucket). PostgreSQL
      // SERIALIZABLE transactions on contended rows routinely abort with a transient
      // serialization_failure/deadlock_detected (40001/40P01) under exactly that traffic
      // pattern — this is expected, not exceptional. Previously there was no retry: any such
      // transient conflict fell into the catch-all below and was converted to an avoidable
      // 503 "Security rate-limit state unavailable", even though the request should simply
      // have been re-evaluated and (most of the time) allowed through or correctly 429'd.
      // Reproduced directly: 10 concurrent consume() calls on a fresh bucket well under
      // capacity produced 7 spurious 503s and only 3 successes. `runSerializableWithRetry` is
      // the same bounded (3-attempt) retry-on-40001/40P01 helper already used elsewhere in
      // this codebase (e.g. the A5 ledger post path, customer registration OTP verify) for
      // exactly this class of contention; it leaves every other error (including the
      // intentional 429 thrown below) untouched.
      await runSerializableWithRetry(this.ds, 'a2-security-rate-limit-consume', async (m) => {
        const r = m.getRepository(A2SecurityRateBucket);
        let b = await r
          .createQueryBuilder('bucket')
          .where('bucket.bucket_key=:bucketKey', { bucketKey })
          .setLock('pessimistic_write')
          .getOne();
        if (!b)
          b = r.create({
            id: randomUUID(),
            bucketKey,
            category: rule.category,
            tokens: rule.capacity,
            lastRefillAt: now,
            expiresAt: new Date(now.getTime() + 86_400_000),
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
        const elapsed = Math.max(0, (now.getTime() - b.lastRefillAt.getTime()) / 1000);
        b.tokens = Math.min(rule.capacity, b.tokens + elapsed * rule.refillRatePerSecond);
        b.lastRefillAt = now;
        if (b.tokens < 1) {
          await r.save(b);
          await this.audit.record(m, {
            entityType: 'A2_SECURITY_RATE_LIMIT',
            entityId: b.id,
            action: 'RATE_LIMIT_REJECTED',
            actor: 'a2-rate-limit',
            correlationId,
            newValues: { category: rule.category, dimensionHash: bucketKey, outcome: 'REJECTED' },
          });
          throw new HttpException('Security request rate exceeded', 429);
        }
        b.tokens -= 1;
        await r.save(b);
      });
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 429) throw e;
      throw new ServiceUnavailableException('Security rate-limit state unavailable');
    }
  }
  private validate(r: A2RateLimitRuleV1) {
    if (
      !Number.isSafeInteger(r.capacity) ||
      r.capacity <= 0 ||
      !Number.isFinite(r.refillRatePerSecond) ||
      r.refillRatePerSecond <= 0 ||
      r.refillRatePerSecond > Number.MAX_SAFE_INTEGER
    )
      throw new ServiceUnavailableException('Invalid security rate-limit configuration');
  }
}
