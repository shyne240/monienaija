import type { EntityManager, QueryRunner } from 'typeorm';

/**
 * Frozen migration-0097 seed snapshot. Do not edit after release; add a new migration for changes.
 * Only these explicitly named ordinary events have editable templates. Security events are
 * represented in the configuration catalogue but never have a template row.
 */
export const NOTIFICATION_DEFAULTS_V1 = [
  {
    eventType: 'customer.funding.approved',
    kind: 'TRANSACTIONAL',
    variables: ['reference', 'amount_clause'],
    body: 'Your funding{{amount_clause}} has been approved. Ref {{reference}}.',
  },
  {
    eventType: 'customer.funding.rejected',
    kind: 'TRANSACTIONAL',
    variables: ['reference', 'amount_clause'],
    body: 'Your funding{{amount_clause}} was not approved. Ref {{reference}}. Contact support.',
  },
  {
    eventType: 'customer.funding.requested',
    kind: 'INFORMATIONAL',
    variables: ['reference', 'amount_clause'],
    body: 'Funding request{{amount_clause}} received. Ref {{reference}}. Awaiting review.',
  },
  {
    eventType: 'transfer.completed',
    kind: 'TRANSACTIONAL',
    variables: ['reference', 'amount_clause'],
    body: 'Transfer{{amount_clause}} completed. Ref {{reference}}.',
  },
  {
    eventType: 'transfer.failed',
    kind: 'TRANSACTIONAL',
    variables: ['reference', 'amount_clause'],
    body: 'Transfer{{amount_clause}} failed. Ref {{reference}}. Contact support.',
  },
  {
    eventType: 'support.ticket.created',
    kind: 'TRANSACTIONAL',
    variables: ['reference'],
    body: "Support ticket {{reference}} created. We'll update you soon.",
  },
  {
    eventType: 'support.ticket.assigned',
    kind: 'TRANSACTIONAL',
    variables: ['reference'],
    body: 'Your support ticket {{reference}} has been assigned.',
  },
  {
    eventType: 'support.ticket.status_changed',
    kind: 'TRANSACTIONAL',
    variables: ['reference', 'status'],
    body: 'Your support ticket {{reference}} status changed to {{status}}.',
  },
  {
    eventType: 'support.ticket.resolved',
    kind: 'TRANSACTIONAL',
    variables: ['reference'],
    body: 'Your support ticket {{reference}} has been resolved.',
  },
  {
    eventType: 'support.ticket.closed',
    kind: 'TRANSACTIONAL',
    variables: ['reference'],
    body: 'Your support ticket {{reference}} has been closed.',
  },
  {
    eventType: 'support.ticket.message_added',
    kind: 'TRANSACTIONAL',
    variables: ['reference'],
    body: 'New update on support ticket {{reference}}. Check your dashboard.',
  },
  // Deliberately no sender phone, transfer number, code or locator URL. There is no new C2C
  // delivery wiring here; the owner must decide the eventual beneficiary messaging contract.
  {
    eventType: 'cash_to_cash.created',
    kind: 'INFORMATIONAL',
    variables: ['reference', 'amount_clause'],
    body: 'Cash-to-cash transfer {{reference}} created{{amount_clause}}. Contact support for details.',
  },
  {
    eventType: 'cash_to_cash.claimed',
    kind: 'INFORMATIONAL',
    variables: ['reference', 'amount_clause'],
    body: 'Cash-to-cash transfer {{reference}} claimed{{amount_clause}}.',
  },
  {
    eventType: 'cash_to_cash.expired',
    kind: 'INFORMATIONAL',
    variables: ['reference', 'amount_clause'],
    body: 'Cash-to-cash transfer {{reference}} expired{{amount_clause}}. Contact support.',
  },
  {
    eventType: 'agent.application.approved',
    kind: 'INFORMATIONAL',
    variables: ['reference'],
    body: 'Agent application {{reference}} approved.',
  },
  {
    eventType: 'agent.application.rejected',
    kind: 'INFORMATIONAL',
    variables: ['reference'],
    body: 'Agent application {{reference}} not approved.',
  },
  {
    eventType: 'agent.activated',
    kind: 'INFORMATIONAL',
    variables: ['reference'],
    body: 'Agent {{reference}} activated.',
  },
  {
    eventType: 'agent.suspended',
    kind: 'INFORMATIONAL',
    variables: ['reference'],
    body: 'Agent {{reference}} suspended. Contact support.',
  },
  {
    eventType: 'agent.terminated',
    kind: 'INFORMATIONAL',
    variables: ['reference'],
    body: 'Agent {{reference}} terminated.',
  },
  {
    eventType: 'agent.reactivated',
    kind: 'INFORMATIONAL',
    variables: ['reference'],
    body: 'Agent {{reference}} reactivated.',
  },
] as const;

export const NOTIFICATION_SECURITY_DEFAULTS_V1 = [
  'customer.registration.phone_verification',
  'customer.credentials.temporary_credential',
  'agent.desk.customer_otp',
] as const;

/** Used by the migration and the test harness after it truncates reference data. */
export async function seedNotificationDefaultsV1(
  query: Pick<EntityManager | QueryRunner, 'query'>,
): Promise<void> {
  for (const item of NOTIFICATION_DEFAULTS_V1) {
    for (const channel of ['SMS', 'EMAIL'] as const) {
      await query.query(
        `INSERT INTO notification_event_configurations
           (event_type, channel, delivery_class, is_enabled, is_locked, version, updated_by)
         VALUES ($1,$2,$3,$4,false,1,'SYSTEM_SEED')
         ON CONFLICT (event_type, channel) DO NOTHING`,
        [item.eventType, channel, item.kind, channel === 'SMS'],
      );
      await query.query(
        `INSERT INTO notification_templates
           (event_type, channel, locale, version, is_active, subject, body, created_by)
         VALUES ($1,$2,'en-NG',1,true,$3,$4,'SYSTEM_SEED')
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
  for (const eventType of NOTIFICATION_SECURITY_DEFAULTS_V1) {
    for (const channel of ['SMS', 'EMAIL'] as const) {
      await query.query(
        `INSERT INTO notification_event_configurations
           (event_type, channel, delivery_class, is_enabled, is_locked, version, updated_by)
         VALUES ($1,$2,'SECURITY',$3,true,1,'SYSTEM_SEED')
         ON CONFLICT (event_type, channel) DO NOTHING`,
        [eventType, channel, channel === 'SMS'],
      );
    }
  }
}
