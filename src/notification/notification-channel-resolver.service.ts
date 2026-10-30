import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { normalizeNigerianPhone } from '../customer-registration/phone-normalization';
import { isSecurityCriticalNotificationEvent } from './notification-security.constants';

export interface ResolvedDestination {
  channel: 'SMS' | 'PUSH' | 'EMAIL';
  destination: string | null;
  reason?: string;
}

type QuerySource = { query(sql: string, params?: unknown[]): Promise<unknown> };
type RecipientType = 'CUSTOMER' | 'AGENT' | 'PHONE';
type Channel = ResolvedDestination['channel'];

@Injectable()
export class NotificationChannelResolverService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Ordinary messages honor channel preferences and require verified customer contacts.
   * An unavailable/missing preference is not consent. Database errors propagate so the
   * caller can durably retry without sending; they are never interpreted as an opt-in.
   * Security OTPs use a separate direct provider path and do not enter the outbox.
   */
  async resolve(
    recipientType: RecipientType,
    recipientId: string,
    channel: Channel,
    manager?: QuerySource,
    eventType?: string | null,
  ): Promise<ResolvedDestination> {
    const source: QuerySource = manager ?? this.dataSource;
    const query = async <T>(sql: string, params: unknown[]): Promise<T[]> =>
      (await source.query(sql, params)) as T[];
    const missing = (reason: string): ResolvedDestination => ({ channel, destination: null, reason });

    if (channel === 'PUSH') {
      if (recipientType === 'CUSTOMER' && !isSecurityCriticalNotificationEvent(eventType)) {
        const rows = await query<{ enabled: boolean | null }>(
          `SELECT notification_push_enabled AS enabled FROM customer_preferences WHERE customer_id=$1 AND deleted_at IS NULL LIMIT 1`,
          [recipientId],
        );
        if (rows[0]?.enabled === false) return missing('PUSH_OPT_OUT');
        if (rows[0]?.enabled !== true) return missing('PUSH_PREFERENCE_UNAVAILABLE');
      }
      return missing('PUSH_TOKEN_DEPENDENCY_MISSING');
    }
    if (recipientType === 'AGENT') return missing(`AGENT_${channel === 'SMS' ? 'PHONE' : 'EMAIL'}_DEPENDENCY_MISSING`);

    const preference = async (customerId: string): Promise<string | null> => {
      if (isSecurityCriticalNotificationEvent(eventType)) return null;
      const column = channel === 'SMS' ? 'notification_sms_enabled' : 'notification_email_enabled';
      const rows = await query<{ enabled: boolean | null }>(
        `SELECT ${column} AS enabled FROM customer_preferences WHERE customer_id=$1 AND deleted_at IS NULL LIMIT 1`,
        [customerId],
      );
      if (rows[0]?.enabled === false) return `${channel}_OPT_OUT`;
      if (rows[0]?.enabled !== true) return `${channel}_PREFERENCE_UNAVAILABLE`;
      return null;
    };

    if (recipientType === 'CUSTOMER') {
      const preferenceReason = await preference(recipientId);
      if (preferenceReason) return missing(preferenceReason);
      const type = channel === 'SMS' ? 'PHONE' : 'EMAIL';
      const contacts = await query<{ normalized_value: string | null }>(
        `SELECT normalized_value FROM customer_contact_methods
          WHERE customer_id=$1 AND type=$2 AND deleted_at IS NULL AND verified_at IS NOT NULL
          ORDER BY is_primary DESC, verified_at DESC, created_at ASC LIMIT 1`,
        [recipientId, type],
      );
      const destination = contacts[0]?.normalized_value;
      if (!destination) return missing(`CUSTOMER_${type}_VERIFIED_MISSING`);
      if (channel === 'SMS') {
        try {
          return { channel, destination: normalizeNigerianPhone(destination).canonical };
        } catch {
          return missing('CUSTOMER_PHONE_INVALID');
        }
      }
      return { channel, destination };
    }

    // The existing C2C contract explicitly permits an unregistered beneficiary phone. It is
    // not a general exemption for ordinary CUSTOMER messages. If the number belongs to any
    // registered contact, verification and each associated customer's preference are required.
    if (recipientType === 'PHONE' && channel === 'SMS' && eventType === 'cash_to_cash.created') {
      let phone: string;
      try {
        phone = normalizeNigerianPhone(recipientId).canonical;
      } catch {
        return missing('INVALID_PHONE_RECIPIENT');
      }
      const contacts = await query<{ customer_id: string; verified_at: Date | null }>(
        `SELECT customer_id, verified_at FROM customer_contact_methods
          WHERE type='PHONE' AND normalized_value = ANY($1::text[]) AND deleted_at IS NULL`,
        [[phone, `0${phone}`, `234${phone}`, `+234${phone}`]],
      );
      if (contacts.some((contact) => !contact.verified_at)) return missing('PHONE_RECIPIENT_UNVERIFIED');
      for (const customerId of new Set(contacts.map((contact) => contact.customer_id))) {
        const preferenceReason = await preference(customerId);
        if (preferenceReason) return missing(preferenceReason);
      }
      return { channel, destination: phone };
    }

    return missing('UNSUPPORTED_RECIPIENT');
  }

  async resolveChannels(
    recipientType: RecipientType,
    recipientId: string,
    preferredChannels: Channel[] = ['SMS'],
    manager?: QuerySource,
  ): Promise<ResolvedDestination[]> {
    const results: ResolvedDestination[] = [];
    for (const channel of preferredChannels) {
      results.push(await this.resolve(recipientType, recipientId, channel, manager));
    }
    return results;
  }
}
