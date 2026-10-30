import { sanitizeDiagnosticIdentifier } from '../common/sensitive-data-redaction';
import { normalizeNigerianPhone } from '../customer-registration/phone-normalization';
import type { NotificationIntent } from './notification.types';
import { canonicalNotificationEvent } from './notification-template.service';

/**
 * V1-005 Event catalogue → recipient/channel/template mapping.
 * Explicit, safe, redacted. Covers required events.
 *
 * Required events:
 *  - funding approved/rejected (CUSTOMER SMS)
 *  - transfer.completed (CUSTOMER SMS to both source & destination)
 *  - support 5 events: created, assigned, status_changed, resolved/closed, message_added
 *  - cash-to-cash claim/expiry
 *  - agent lifecycle (transaction/operational/support/lifecycle) — dependency
 */

export function mapEventToIntents(
  eventType: string,
  payload: Record<string, unknown>,
  outbox: { correlationId: string | null; causationId: string | null },
): NotificationIntent[] {
  // Report 26 (N-02): correlation ids persisted on outbox rows by
  // pre-remediation producers (or any future non-choke-point writer) are
  // sanitized here so every generated intent — and thus every delivery record
  // and provider log derived from it — can only carry a bounded, redacted
  // value. Deterministic: legitimate ids pass through byte-for-byte.
  const correlationId = sanitizeDiagnosticIdentifier(outbox.correlationId) ?? null;
  const causationId = outbox.causationId;

  // Customer funding approved / rejected — single CUSTOMER SMS
  if (eventType === 'customer.funding.approved' || eventType === 'customer.funding.rejected') {
    const customerId = payload.customerId as string | undefined;
    if (!customerId) return [];
    return [
      {
        recipientType: 'CUSTOMER',
        recipientId: customerId,
        channel: 'SMS',
        templateKey: eventType,
        correlationId,
        causationId,
      },
    ];
  }

  if (eventType === 'customer.funding.requested') {
    const customerId = payload.customerId as string | undefined;
    if (!customerId) return [];
    return [
      {
        recipientType: 'CUSTOMER',
        recipientId: customerId,
        channel: 'SMS',
        templateKey: eventType,
        correlationId,
        causationId,
      },
    ];
  }

  // Transfer events — internal transfer completed
  if (eventType === 'transfer.completed') {
    const sourceCustomerId = payload.sourceCustomerId as string | undefined;
    const destinationCustomerId = payload.destinationCustomerId as string | undefined;
    const intents: NotificationIntent[] = [];
    if (sourceCustomerId) {
      intents.push({
        recipientType: 'CUSTOMER',
        recipientId: sourceCustomerId,
        channel: 'SMS',
        templateKey: 'transfer.completed',
        correlationId,
        causationId,
      });
    }
    // Avoid duplicate if same customer (self-transfer edge)
    if (destinationCustomerId && destinationCustomerId !== sourceCustomerId) {
      intents.push({
        recipientType: 'CUSTOMER',
        recipientId: destinationCustomerId,
        channel: 'SMS',
        templateKey: 'transfer.completed',
        correlationId,
        causationId,
      });
    }
    return intents;
  }

  if (eventType === 'transfer.failed' || eventType === 'transfer.unknown') {
    const sourceCustomerId =
      (payload.sourceCustomerId as string | undefined) ?? (payload.customerId as string | undefined);
    if (!sourceCustomerId) return [];
    return [
      {
        recipientType: 'CUSTOMER',
        recipientId: sourceCustomerId,
        channel: 'SMS',
        templateKey: 'transfer.failed',
        correlationId,
        causationId,
      },
    ];
  }

  // Support ticket events
  const supportMap: Record<string, boolean> = {
    'support.ticket.created': true,
    'support.ticket.assigned': true,
    'support.ticket.status_changed': true,
    'support.ticket.resolved': true,
    'support.ticket.closed': true,
    'support.ticket.message_added': true,
  };
  if (supportMap[eventType]) {
    // payload contains ticketId/reference/customerId/agentId
    // Do NOT leak internal notes: message_added with isInternal true is filtered elsewhere
    const isInternal = (payload.isInternal as boolean | undefined) ?? false;
    if (eventType === 'support.ticket.message_added' && isInternal === true) {
      return []; // internal notes never sent
    }

    const customerId = payload.customerId as string | undefined | null;
    const agentId = payload.agentId as string | undefined | null;
    const intents: NotificationIntent[] = [];

    // Status mapping: status_changed with status RESOLVED/CLOSED should use resolved/closed template
    let templateKey = eventType;
    if (eventType === 'support.ticket.status_changed') {
      const status = (payload.status as string | undefined) ?? (payload.newStatus as string | undefined);
      if (status === 'RESOLVED') templateKey = 'support.ticket.resolved';
      else if (status === 'CLOSED') templateKey = 'support.ticket.closed';
    }

    if (customerId) {
      intents.push({
        recipientType: 'CUSTOMER',
        recipientId: customerId,
        channel: 'SMS',
        templateKey,
        correlationId,
        causationId,
      });
    }
    if (agentId) {
      intents.push({
        recipientType: 'AGENT',
        recipientId: agentId,
        channel: 'SMS',
        templateKey,
        correlationId,
        causationId,
      });
    }
    // If no customer/agent bound (operational ticket), notify assigned_to or creator? For V1, skip.
    return intents;
  }

  // Cash-to-cash initiation targets a phone directly so registration is not a prerequisite.
  // The phone is used as a recipient key only; template output is limited to explicit safe vars.
  if (eventType === 'cash_to_cash.created') {
    let beneficiaryPhone: string;
    try {
      if (typeof payload.beneficiaryPhone !== 'string') return [];
      beneficiaryPhone = normalizeNigerianPhone(payload.beneficiaryPhone).canonical;
    } catch {
      return [];
    }
    return [
      {
        recipientType: 'PHONE',
        recipientId: beneficiaryPhone,
        channel: 'SMS',
        templateKey: 'cash_to_cash.created',
        correlationId,
        causationId,
      },
    ];
  }

  // Cash-to-cash
  if (
    eventType === 'cash_to_cash.claimed' ||
    eventType === 'cash_to_cash.expired' ||
    eventType === 'cash-to-cash.claimed' ||
    eventType === 'cash-to-cash.expired'
  ) {
    // beneficiaryPhone not a customer ID — we need to resolve via phone? But recipient is not known as customer.
    // For V1, use claimantCustomerId or agentId if present.
    const claimantCustomerId = payload.claimantCustomerId as string | undefined;
    const beneficiaryId = payload.beneficiaryId as string | undefined;
    const agentId = payload.agentId as string | undefined;
    const intents: NotificationIntent[] = [];
    if (claimantCustomerId) {
      intents.push({
        recipientType: 'CUSTOMER',
        recipientId: claimantCustomerId,
        channel: 'SMS',
        templateKey: canonicalNotificationEvent(eventType),
        correlationId,
        causationId,
      });
    } else if (beneficiaryId) {
      intents.push({
        recipientType: 'CUSTOMER',
        recipientId: beneficiaryId,
        channel: 'SMS',
        templateKey: canonicalNotificationEvent(eventType),
        correlationId,
        causationId,
      });
    }
    if (agentId) {
      intents.push({
        recipientType: 'AGENT',
        recipientId: agentId,
        channel: 'SMS',
        templateKey: canonicalNotificationEvent(eventType),
        correlationId,
        causationId,
      });
    }
    return intents;
  }

  // Agent lifecycle — future outbox events like agent.suspended etc.
  const agentLifecycleMap: Record<string, string> = {
    'agent.activated': 'agent.activated',
    'agent.suspended': 'agent.suspended',
    'agent.terminated': 'agent.terminated',
    'agent.reactivated': 'agent.reactivated',
    'agent.application.approved': 'agent.application.approved',
    'agent.application.rejected': 'agent.application.rejected',
  };
  if (agentLifecycleMap[eventType]) {
    const agentId =
      (payload.agentId as string | undefined) ??
      (payload.aggregateId as string | undefined) ??
      (payload.applicantReference as string | undefined);
    if (!agentId) return [];
    // agentId may be reference string, but we expect UUID; if not UUID, skip V1
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) return [];
    return [
      {
        recipientType: 'AGENT',
        recipientId: agentId,
        channel: 'SMS',
        templateKey: agentLifecycleMap[eventType],
        correlationId,
        causationId,
      },
    ];
  }

  // Fallback: unknown event — no notification (not every audit generates notification)
  return [];
}

/**
 * ARENA3-NOTIFICATION-EMAIL — EMAIL intent augmentation for CUSTOMER recipients.
 *
 * `mapEventToIntents` above is deliberately UNCHANGED (SMS/PUSH-only, byte-preserved —
 * requirement: preserve all existing SMS behaviour). The dispatcher calls this helper
 * ONLY when an email provider is configured (NOTIFICATION_EMAIL_PROVIDER != none);
 * while email is dark, no EMAIL intents are generated at all (no SKIPPED-row churn).
 *
 * Scope: already-live wired events with CUSTOMER recipients only. cash_to_cash.* and
 * agent.* intents are intentionally NOT augmented (agent email is a documented dependency —
 * AGENT_EMAIL_DEPENDENCY_MISSING; cash-to-cash beneficiary wiring is out of mission scope).
 * SMS intents are never modified — EMAIL copies are appended after them.
 */
const EMAIL_ENABLED_CUSTOMER_EVENTS: ReadonlySet<string> = new Set([
  'customer.funding.requested',
  'customer.funding.approved',
  'customer.funding.rejected',
  'transfer.completed',
  'transfer.failed',
  'transfer.unknown',
  'support.ticket.created',
  'support.ticket.assigned',
  'support.ticket.status_changed',
  'support.ticket.resolved',
  'support.ticket.closed',
  'support.ticket.message_added',
]);

export function appendCustomerEmailIntents(
  eventType: string,
  intents: NotificationIntent[],
): NotificationIntent[] {
  if (!EMAIL_ENABLED_CUSTOMER_EVENTS.has(eventType)) return intents;
  const copies: NotificationIntent[] = [];
  for (const intent of intents) {
    if (intent.recipientType !== 'CUSTOMER') continue;
    copies.push({ ...intent, channel: 'EMAIL' });
  }
  return copies.length > 0 ? [...intents, ...copies] : intents;
}

/**
 * Full catalogue documentation for V1-005 verification.
 */
export const NOTIFICATION_EVENT_CATALOGUE: Array<{
  eventType: string;
  recipient: string;
  channel: string;
  templateKey: string;
  required: boolean;
  possible: boolean;
  fallback: string;
}> = [
  // CUSTOMER
  {
    eventType: 'customer.funding.approved',
    recipient: 'CUSTOMER (customerId from payload)',
    channel: 'SMS (CUSTOMER PHONE via customer_contact_methods.normalized_value)',
    templateKey: 'customer.funding.approved',
    required: true,
    possible: true,
    fallback: 'If phone missing: delivery SKIPPED with reason CUSTOMER_PHONE_MISSING, audit only',
  },
  {
    eventType: 'customer.funding.rejected',
    recipient: 'CUSTOMER',
    channel: 'SMS',
    templateKey: 'customer.funding.rejected',
    required: true,
    possible: true,
    fallback: 'Same as approved',
  },
  {
    eventType: 'transfer.completed',
    recipient: 'CUSTOMER (sourceCustomerId AND destinationCustomerId)',
    channel: 'SMS to both',
    templateKey: 'transfer.completed',
    required: true,
    possible: true,
    fallback: 'If one phone missing, other still delivered; duplicate suppressed via eventKey',
  },
  {
    eventType: 'support.ticket.created',
    recipient: 'CUSTOMER and/or AGENT (payload customerId/agentId)',
    channel: 'SMS',
    templateKey: 'support.ticket.created',
    required: true,
    possible: true,
    fallback: 'If no customer/agent bound, SKIPPED (operational ticket)',
  },
  {
    eventType: 'support.ticket.assigned',
    recipient: 'CUSTOMER/AGENT',
    channel: 'SMS',
    templateKey: 'support.ticket.assigned',
    required: true,
    possible: true,
    fallback: 'Same',
  },
  {
    eventType: 'support.ticket.status_changed',
    recipient: 'CUSTOMER/AGENT',
    channel: 'SMS',
    templateKey: 'status_changed → resolved/closed mapped',
    required: true,
    possible: true,
    fallback: 'Internal status only; mapped template',
  },
  {
    eventType: 'support.ticket.resolved',
    recipient: 'CUSTOMER/AGENT',
    channel: 'SMS',
    templateKey: 'support.ticket.resolved',
    required: true,
    possible: true,
    fallback: 'Via status_changed RESOLVED',
  },
  {
    eventType: 'support.ticket.closed',
    recipient: 'CUSTOMER/AGENT',
    channel: 'SMS',
    templateKey: 'support.ticket.closed',
    required: true,
    possible: true,
    fallback: 'Via status_changed CLOSED',
  },
  {
    eventType: 'support.ticket.message_added',
    recipient: 'CUSTOMER/AGENT (customerId/agentId), isInternal filtered',
    channel: 'SMS',
    templateKey: 'support.ticket.message_added',
    required: true,
    possible: true,
    fallback: 'If isInternal true → NO notification (isolation)',
  },
  // CASH-TO-CASH
  {
    eventType: 'cash_to_cash.created',
    recipient: 'PHONE (beneficiaryPhone; registration is not required)',
    channel:
      'SMS to canonical Nigerian phone; verified customer SMS preference honored when available',
    templateKey: 'cash_to_cash.created',
    required: true,
    possible: true,
    fallback:
      'Malformed/missing phone is not dispatched; delivery is idempotent by eventKey + phone + channel',
  },
  {
    eventType: 'cash_to_cash.claimed',
    recipient: 'CUSTOMER (claimant) + AGENT (sender)',
    channel: 'SMS',
    templateKey: 'cash_to_cash.claimed',
    required: false,
    possible: true,
    fallback: 'If no outbox event yet, documented dependency; future claim outbox will map',
  },
  {
    eventType: 'cash_to_cash.expired',
    recipient: 'CUSTOMER + AGENT',
    channel: 'SMS',
    templateKey: 'cash_to_cash.expired',
    required: false,
    possible: true,
    fallback: 'Same',
  },
  // AGENT
  {
    eventType: 'agent.activated',
    recipient: 'AGENT',
    channel: 'SMS (dependency: Agent phone not authoritative)',
    templateKey: 'agent.activated',
    required: false,
    possible: false,
    fallback: 'SKIPPED with AGENT_PHONE_DEPENDENCY_MISSING until agent contact model exists',
  },
  {
    eventType: 'agent.suspended',
    recipient: 'AGENT',
    channel: 'SMS',
    templateKey: 'agent.suspended',
    required: false,
    possible: false,
    fallback: 'Same',
  },
  {
    eventType: 'agent.terminated',
    recipient: 'AGENT',
    channel: 'SMS',
    templateKey: 'agent.terminated',
    required: false,
    possible: false,
    fallback: 'Same',
  },
  {
    eventType: 'agent.reactivated',
    recipient: 'AGENT',
    channel: 'SMS',
    templateKey: 'agent.reactivated',
    required: false,
    possible: false,
    fallback: 'Same',
  },
  // PUSH (dependency)
  {
    eventType: '* (any above)',
    recipient: 'CUSTOMER/AGENT',
    channel: 'PUSH (device-token model missing)',
    templateKey: '*',
    required: false,
    possible: false,
    fallback: 'SKIPPED PUSH_TOKEN_DEPENDENCY_MISSING until device-token entity exists; notification_push_enabled respected',
  },
  // EMAIL (ARENA3-NOTIFICATION-EMAIL)
  {
    eventType: 'customer.funding.* / transfer.completed|failed|unknown / support.ticket.*',
    recipient: 'CUSTOMER only (AGENT email is a documented dependency)',
    channel: 'EMAIL (customer_contact_methods type=EMAIL normalized_value; only generated when NOTIFICATION_EMAIL_PROVIDER is configured)',
    templateKey: 'same as SMS intent — plain-text body identical (NotificationEmailTemplateLookup seam)',
    required: false,
    possible: true,
    fallback: 'Email dark (provider none): no EMAIL intent generated. Configured: EMAIL_OPT_OUT (notification_email_enabled=false, security-critical events bypass), CUSTOMER_EMAIL_MISSING, AGENT_EMAIL_DEPENDENCY_MISSING → SKIPPED with reason; provider failure → FAILED with bounded retries via worker',
  },
];
