import type { EntityManager, QueryRunner } from 'typeorm';

import { NOTIFICATION_DEFAULTS_V1 } from './notification-defaults-v1';

/**
 * Migration-0103's additive snapshot. The 0098 defaults remain frozen.
 * Deposit/withdrawal messages deliberately contain no journal, failure detail, amount or
 * untrusted recipient data. Their owner is resolved from the committed payment's wallet.
 */
export const NOTIFICATION_ADDITIONAL_DEFAULTS_V2 = [
  {
    eventType: 'deposit.completed',
    kind: 'TRANSACTIONAL',
    variables: [],
    body: 'Your deposit has been completed. Check your account for details.',
  },
  {
    eventType: 'deposit.failed',
    kind: 'TRANSACTIONAL',
    variables: [],
    body: 'Your deposit was not completed. Check your account for details.',
  },
  {
    eventType: 'withdrawal.completed',
    kind: 'TRANSACTIONAL',
    variables: [],
    body: 'Your withdrawal has been completed. Check your account for details.',
  },
  {
    eventType: 'withdrawal.failed',
    kind: 'TRANSACTIONAL',
    variables: [],
    body: 'Your withdrawal was not completed. Check your account for details.',
  },
  {
    eventType: 'transfer.unknown',
    kind: 'TRANSACTIONAL',
    variables: [],
    body: 'Your transfer status is being confirmed. Check your account for updates.',
  },
] as const;

export const NOTIFICATION_ORDINARY_DEFAULTS = [
  ...NOTIFICATION_DEFAULTS_V1,
  ...NOTIFICATION_ADDITIONAL_DEFAULTS_V2,
] as const;

/** Only financial outcomes are affected by the owner-approved removal of legacy locks. */
export const FINANCIAL_NOTIFICATION_EVENT_TYPES = [
  'customer.funding.requested',
  'customer.funding.approved',
  'customer.funding.rejected',
  'deposit.completed',
  'deposit.failed',
  'withdrawal.completed',
  'withdrawal.failed',
  'transfer.completed',
  'transfer.failed',
  'transfer.unknown',
  'cash_to_cash.created',
  'cash_to_cash.claimed',
  'cash_to_cash.expired',
] as const;

export const NEW_PAYMENT_NOTIFICATION_EVENTS: ReadonlySet<string> = new Set([
  'deposit.completed',
  'deposit.failed',
  'withdrawal.completed',
  'withdrawal.failed',
]);

/** Seed only absent 0103 reference rows; never overwrite existing governed choices. */
export async function seedNotificationDefaultsV2(
  query: Pick<EntityManager | QueryRunner, 'query'>,
): Promise<void> {
  for (const item of NOTIFICATION_ADDITIONAL_DEFAULTS_V2) {
    for (const channel of ['SMS', 'EMAIL'] as const) {
      // Before 0103, transfer.unknown used transfer.failed's channel configuration.
      // Copy its current setting once so upgrades preserve behavior, then decouple them.
      const inherited =
        item.eventType === 'transfer.unknown'
          ? ((await query.query(
              `SELECT is_enabled FROM notification_event_configurations WHERE event_type='transfer.failed' AND channel=$1`,
              [channel],
            )) as Array<{ is_enabled: boolean }>)
          : [];
      await query.query(
        `INSERT INTO notification_event_configurations
           (event_type, channel, delivery_class, is_enabled, is_locked, version, updated_by)
         VALUES ($1,$2,$3,$4,false,1,'SYSTEM_SEED_0103')
         ON CONFLICT (event_type, channel) DO NOTHING`,
        [item.eventType, channel, item.kind, inherited[0]?.is_enabled ?? false],
      );
      await query.query(
        `INSERT INTO notification_templates
           (event_type, channel, locale, version, is_active, subject, body, created_by)
         SELECT $1::varchar,$2::varchar,'en-NG',1,true,$3,$4,'SYSTEM_SEED_0103'
          WHERE NOT EXISTS (SELECT 1 FROM notification_templates
                             WHERE event_type=$1::varchar AND channel=$2::varchar AND locale='en-NG')
         ON CONFLICT (event_type, channel, locale, version) DO NOTHING`,
        [
          item.eventType,
          channel,
          channel === 'EMAIL' ? 'MonieNaija account update' : null,
          item.body,
        ],
      );
    }
  }
  for (const item of NOTIFICATION_ORDINARY_DEFAULTS) {
    await query.query(
      `INSERT INTO notification_event_configurations
         (event_type, channel, delivery_class, is_enabled, is_locked, version, updated_by)
       VALUES ($1,'EVENT',$2,$3,false,1,'SYSTEM_SEED_0103')
       ON CONFLICT (event_type, channel) DO NOTHING`,
      [item.eventType, item.kind, !NEW_PAYMENT_NOTIFICATION_EVENTS.has(item.eventType)],
    );
  }
}
