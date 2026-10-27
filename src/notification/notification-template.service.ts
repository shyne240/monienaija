import { BadRequestException, Injectable } from '@nestjs/common';

import { redactRecord } from '../common/sensitive-data-redaction';
import { NOTIFICATION_DEFAULTS_V1 } from './notification-defaults-v1';
import { isSecurityCriticalNotificationEvent } from './notification-security.constants';

export type TemplateChannel = 'SMS' | 'EMAIL';
export type TemplateDefinition = (typeof NOTIFICATION_DEFAULTS_V1)[number];
export interface TemplateContent {
  subject: string | null;
  body: string;
}
export interface RenderedTemplate extends TemplateContent {
  variablesUsed: string[];
}
export interface TemplateQuery {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

/** Internal aliases are normalized before config lookup; customer-facing text never contains them. */
export function canonicalNotificationEvent(eventType: string): string {
  if (eventType === 'transfer.unknown') return 'transfer.failed';
  if (eventType === 'cash-to-cash.claimed') return 'cash_to_cash.claimed';
  if (eventType === 'cash-to-cash.expired') return 'cash_to_cash.expired';
  return eventType;
}

/** Plain-text, allowlist-only templates. There is deliberately no expression or property evaluator. */
@Injectable()
export class NotificationTemplateService {
  redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return redactRecord(payload);
  }

  definition(eventType: string): TemplateDefinition | undefined {
    return NOTIFICATION_DEFAULTS_V1.find((entry) => entry.eventType === eventType);
  }

  requireDefinition(eventType: string): TemplateDefinition {
    if (isSecurityCriticalNotificationEvent(eventType)) {
      throw new BadRequestException('Security notifications cannot use editable templates');
    }
    const def = this.definition(eventType);
    if (!def) throw new BadRequestException('Unknown notification event');
    return def;
  }

  formatNgn(minor: string | number): string {
    const value = String(minor).trim();
    if (!/^\d{1,15}$/.test(value)) return '';
    // Decimal currency formatting is exact even at the upper bound; no floating-point rounding.
    const amount = BigInt(value);
    return `NGN ${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
  }

  /**
   * Defence in depth for literal and rendered text. The allowlisted resolvers are the primary
   * secret boundary; this rejects recognizable credential/control/HTML content, not every
   * possible secret a human could deliberately paste into literal text.
   */
  assertSafe(message: string): void {
    if (
      typeof message !== 'string' ||
      // eslint-disable-next-line no-control-regex -- reject unsafe control bytes explicitly
      /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message) ||
      /\b(?:pin|otp|password|passcode|credential|secret|token|ledger|journal|authorization)\b/i.test(
        message,
      ) ||
      /\b(?:api[ _-]?key|verification[ _-]?code|recovery[ _-]?code|one[ _-]?time[ _-]?code)\b/i.test(
        message,
      )
    ) {
      throw new BadRequestException('Unsafe notification content');
    }
  }

  validateTemplate(
    eventType: string,
    channel: TemplateChannel,
    content: TemplateContent,
  ): string[] {
    const definition = this.requireDefinition(eventType);
    if (channel !== 'SMS' && channel !== 'EMAIL')
      throw new BadRequestException('Unsupported template channel');
    if (
      typeof content.body !== 'string' ||
      !content.body.trim() ||
      content.body.length > (channel === 'SMS' ? 1000 : 4000)
    ) {
      throw new BadRequestException('Invalid template body');
    }
    if (channel === 'SMS' && content.subject !== null)
      throw new BadRequestException('SMS must not have a subject');
    if (
      channel === 'EMAIL' &&
      (typeof content.subject !== 'string' ||
        !content.subject.trim() ||
        content.subject.length > 200 ||
        /[\r\n]/.test(content.subject))
    ) {
      throw new BadRequestException('Invalid email subject');
    }
    const used = new Set<string>();
    for (const text of [content.body, content.subject ?? '']) {
      this.assertSafe(text);
      const literals = text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_match, name: string) => {
        if (!(definition.variables as readonly string[]).includes(name)) {
          throw new BadRequestException('Template variable is not allowed for this event');
        }
        used.add(name);
        return '';
      });
      if (/[{}]/.test(literals)) throw new BadRequestException('Invalid template syntax');
      // Literal long digit sequences can carry phone numbers or one-time credentials. Monetary
      // values and references must come through vetted variable resolvers instead.
      if (/\d{6,}/.test(literals))
        throw new BadRequestException('Long literal digit sequences are not allowed');
      if (/https?:\/\/|www\.|\b[^\s@]+@[^\s@]+\.[^\s@]+/i.test(literals)) {
        throw new BadRequestException('Literal links and email addresses are not allowed');
      }
    }
    // Reject templates whose worst-case allowed substitutions could overflow at runtime. This
    // prevents an approved template that previews successfully from wedging a later outbox event.
    const maxima: Record<string, string> = {
      reference: 'R'.repeat(20),
      amount_clause: ' of NGN 9999999999999.99',
      status: 'IN_PROGRESS',
    };
    const expandedLength = (text: string) =>
      text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_match, name: string) => maxima[name] ?? '')
        .length;
    if (
      expandedLength(content.body) > (channel === 'SMS' ? 1000 : 4000) ||
      (content.subject !== null && expandedLength(content.subject) > 200)
    ) {
      throw new BadRequestException('Template can exceed channel limits');
    }
    return [...used].sort();
  }

  render(
    eventType: string,
    channel: TemplateChannel,
    content: TemplateContent,
    payload: Record<string, unknown>,
  ): RenderedTemplate {
    const variablesUsed = this.validateTemplate(eventType, channel, content);
    const safe = this.redactPayload(payload);
    const values = this.resolveVariables(eventType, safe);
    const interpolate = (text: string) =>
      text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_match, name: string) => values[name] ?? '');
    const body = interpolate(content.body);
    const subject = content.subject === null ? null : interpolate(content.subject);
    this.assertSafe(body);
    if (subject !== null) this.assertSafe(subject);
    if (body.length > (channel === 'SMS' ? 1000 : 4000) || (subject && subject.length > 200)) {
      throw new BadRequestException('Rendered notification exceeds channel limits');
    }
    return { subject, body, variablesUsed };
  }

  /** Fixed synthetic values only: the API cannot pass user/customer sample payloads. */
  preview(eventType: string, channel: TemplateChannel, content: TemplateContent): RenderedTemplate {
    return this.render(eventType, channel, content, {
      reference: 'SAMPLE-1',
      transferId: 'a1b2c3d4-0000-4000-8000-000000000000',
      amountMinor: '125000',
      status: 'OPEN',
    });
  }

  async isEventEnabled(
    query: TemplateQuery,
    eventType: string,
    channel: TemplateChannel,
  ): Promise<boolean> {
    const canonical = canonicalNotificationEvent(eventType);
    this.requireDefinition(canonical);
    const rows = (await query.query(
      `SELECT is_enabled, delivery_class FROM notification_event_configurations
      WHERE event_type=$1 AND channel=$2`,
      [canonical, channel],
    )) as Array<{ is_enabled: boolean; delivery_class: string }>;
    if (rows.length !== 1 || rows[0]!.delivery_class === 'SECURITY') {
      throw new Error('Notification event configuration unavailable');
    }
    return rows[0]!.is_enabled;
  }

  async renderActive(
    query: TemplateQuery,
    eventType: string,
    channel: TemplateChannel,
    payload: Record<string, unknown>,
  ): Promise<RenderedTemplate> {
    this.requireDefinition(eventType);
    const rows = (await query.query(
      `SELECT subject, body FROM notification_templates
        WHERE event_type=$1 AND channel=$2 AND locale='en-NG' AND is_active=true`,
      [eventType, channel],
    )) as Array<{ subject: string | null; body: string }>;
    if (rows.length !== 1) throw new Error('Active notification template unavailable');
    return this.render(eventType, channel, rows[0]!, payload);
  }

  /** Compatibility helper for direct callers; production dispatch reads the persistent registry. */
  buildMessage(eventType: string, payload: Record<string, unknown>): string {
    if (isSecurityCriticalNotificationEvent(eventType))
      throw new BadRequestException('Security notifications cannot use editable templates');
    const canonical = canonicalNotificationEvent(eventType);
    const def = this.definition(canonical);
    if (!def) return 'You have a new update. Please check your account.';
    return this.render(canonical, 'SMS', { subject: null, body: def.body }, payload).body;
  }

  private resolveVariables(
    eventType: string,
    payload: Record<string, unknown>,
  ): Record<string, string> {
    const referenceSource =
      eventType === 'transfer.completed' && typeof payload.transferId === 'string'
        ? payload.transferId.slice(0, 8)
        : typeof payload.reference === 'string'
          ? payload.reference
          : typeof payload.fundingRequestId === 'string'
            ? payload.fundingRequestId.slice(0, 8)
            : '';
    const candidate = referenceSource.length > 20 ? referenceSource.slice(0, 8) : referenceSource;
    let reference = 'your request';
    // Restrict public references to known display-reference shapes or a short UUID prefix.
    // Never copy arbitrary user text, a long digit sequence, or a credential-looking value.
    const publicShape =
      /^(?:CF|FUND|SUP|TRF|REF|AG|SAMPLE|CASH_TO_CASH)-[A-Za-z0-9_-]+$/i.test(candidate) ||
      /^[a-f0-9]{8}$/i.test(candidate);
    const digitCount = candidate.replace(/\D/g, '').length;
    const sensitiveWord =
      /otp|pin|password|passcode|credential|secret|token|api.?key|ledger|journal|robe_/i.test(
        candidate,
      );
    if (candidate.length <= 20 && publicShape && digitCount < 6 && !sensitiveWord) {
      try {
        this.assertSafe(candidate);
        reference = candidate;
      } catch {
        /* reject untrusted reference */
      }
    }
    const minor = payload.amountMinor ?? payload.principal_minor;
    const amount =
      typeof minor === 'string' || typeof minor === 'number' ? this.formatNgn(minor) : '';
    const rawStatus = payload.status ?? payload.newStatus;
    const allowedStatuses = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'];
    const status =
      typeof rawStatus === 'string' && allowedStatuses.includes(rawStatus) ? rawStatus : 'updated';
    return { reference, amount_clause: amount ? ` of ${amount}` : '', status };
  }
}
