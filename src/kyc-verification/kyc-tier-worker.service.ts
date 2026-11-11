import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { KycTierTransitionService } from './kyc-tier-transition.service';
import type { KycTierPolicyService } from './kyc-tier-policy.service';

/** Bounded, persistent work; customer locks and queue revisions serialize concurrent workers. */
@Injectable()
export class KycTierWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private readonly logger = new Logger(KycTierWorker.name);
  constructor(
    private readonly db: DataSource,
    private readonly transitions: KycTierTransitionService,
    private readonly policies: KycTierPolicyService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 30000);
    this.timer.unref();
    void this.tick();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.active;
  }
  tick(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.run()
      .catch(() => {
        this.logger.error('KYC reevaluation tick failed');
      })
      .finally(() => {
        this.active = null;
      });
    return this.active;
  }
  private async run(): Promise<void> {
    await this.db.transaction(async (m) => {
      // Process each expiry once; a change in expiry time is a new event.
      await m.query(`WITH due AS (
        SELECT 'ATTEMPT'::varchar AS source,id AS source_id,expires_at,customer_id FROM kyc_verification_attempts WHERE outcome='MATCH' AND expires_at<=clock_timestamp()
        UNION ALL SELECT 'CONSENT'::varchar,id,expires_at,customer_id FROM kyc_consents WHERE expires_at<=clock_timestamp()
        UNION ALL SELECT 'ASSESS'::varchar,id,expires_at,customer_id FROM customer_kyc_assessments WHERE is_current=true AND expires_at<=clock_timestamp()
      ), selected AS (SELECT d.* FROM due d WHERE NOT EXISTS(SELECT 1 FROM kyc_tier_expiry_events e WHERE e.source=d.source AND e.source_id=d.source_id AND e.expires_at=d.expires_at) ORDER BY d.expires_at LIMIT 100),
      marked AS (INSERT INTO kyc_tier_expiry_events(source,source_id,expires_at) SELECT source,source_id,expires_at FROM selected ON CONFLICT DO NOTHING RETURNING source,source_id,expires_at),
      affected AS (SELECT DISTINCT s.customer_id FROM selected s JOIN marked m USING(source,source_id,expires_at))
      INSERT INTO kyc_evaluation_refresh(customer_id) SELECT customer_id FROM affected ON CONFLICT(customer_id) DO UPDATE SET revision=kyc_evaluation_refresh.revision+1,requested_at=clock_timestamp(),retry_after=clock_timestamp()`);
    });
    await this.db.transaction(async (m) => {
      const rows = await m.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
      const p = await this.policies.effective(m, rows[0]!.now);
      await m.query(
        `WITH latest AS (SELECT DISTINCT ON(customer_id) customer_id,policy_version FROM kyc_tier_evaluations ORDER BY customer_id,created_at DESC,id DESC), candidates AS (
        SELECT l.customer_id FROM latest l JOIN kyc_evaluation_refresh q ON q.customer_id=l.customer_id WHERE l.policy_version IS DISTINCT FROM $1::integer AND q.revision=q.processed_revision LIMIT 100)
        INSERT INTO kyc_evaluation_refresh(customer_id) SELECT customer_id FROM candidates ON CONFLICT(customer_id) DO UPDATE SET revision=kyc_evaluation_refresh.revision+1,requested_at=clock_timestamp(),retry_after=clock_timestamp()`,
        [p?.version ?? null],
      );
    });
    await this.transitions.processBatch();
  }
}
