/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface ResolvedDestination {
  channel: 'SMS' | 'PUSH';
  destination: string | null; // null means dependency missing (e.g. Push token absent)
  reason?: string; // for SKIPPED
}

@Injectable()
export class NotificationChannelResolverService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Resolve destination for recipient+channel.
   * Customer SMS: authoritative CustomerContactMethod PHONE normalizedValue (is_primary preferred).
   * Agent SMS: no authoritative phone — documented dependency (SKIPPED).
   * Push: requires device-token model — not present V1 — return dependency missing (SKIPPED).
   * Preferences: notification_push_enabled respected; notification_sms_enabled currently default true (V1-016 defer).
   */
  async resolve(
    recipientType: 'CUSTOMER' | 'AGENT',
    recipientId: string,
    channel: 'SMS' | 'PUSH',
    manager?: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  ): Promise<ResolvedDestination> {
    const ds = (manager as unknown as DataSource) ?? this.dataSource;
    const query = (sql: string, params: unknown[]) => (ds as any).query(sql, params) as Promise<Array<any>>;

    if (channel === 'PUSH') {
      // Push requires device-token model — missing V1
      // Check notification_push_enabled preference; if false, SKIPPED as opt-out.
      if (recipientType === 'CUSTOMER') {
        try {
          const prefRows = await query(
            `SELECT notification_push_enabled AS push_enabled FROM customer_preferences WHERE customer_id=$1 AND deleted_at IS NULL LIMIT 1`,
            [recipientId],
          );
          const pushEnabled = prefRows[0]?.push_enabled;
          // If preference exists and is false, respect opt-out
          if (pushEnabled === false) {
            return { channel: 'PUSH', destination: null, reason: 'PUSH_OPT_OUT' };
          }
        } catch {
          // ignore preference lookup failure
        }
      }
      // No device token table — dependency
      return { channel: 'PUSH', destination: null, reason: 'PUSH_TOKEN_DEPENDENCY_MISSING' };
    }

    // SMS
    if (recipientType === 'CUSTOMER') {
      // Reuse authoritative CustomerContactMethod PHONE
      const rows = await query(
        `SELECT normalized_value FROM customer_contact_methods
          WHERE customer_id=$1 AND type='PHONE' AND deleted_at IS NULL
          ORDER BY is_primary DESC, verified_at DESC NULLS LAST, created_at ASC
          LIMIT 1`,
        [recipientId],
      );
      const phone = rows[0]?.normalized_value as string | undefined;
      if (!phone) {
        return { channel: 'SMS', destination: null, reason: 'CUSTOMER_PHONE_MISSING' };
      }
      // Canonical 10-digit or full normalized_value — use as stored (V1 preserves existing normalization)
      return { channel: 'SMS', destination: phone };
    }

    // AGENT SMS — no authoritative phone field on Agent/AgentApplication (contact_email only)
    // Search agent_applications for agent_id? Agent → originApplicationId → contact_email is email, not phone.
    // Therefore Agent SMS is dependency.
    if (recipientType === 'AGENT') {
      // Future: if agent has receiving number or linked customer phone, resolve here.
      // For V1, mark SKIPPED with documented dependency.
      return { channel: 'SMS', destination: null, reason: 'AGENT_PHONE_DEPENDENCY_MISSING' };
    }

    return { channel, destination: null, reason: 'UNSUPPORTED_RECIPIENT' };
  }

  /**
   * Resolve both channels where possible, but V1 prefers SMS.
   */
  async resolveChannels(
    recipientType: 'CUSTOMER' | 'AGENT',
    recipientId: string,
    preferredChannels: Array<'SMS' | 'PUSH'> = ['SMS'],
    manager?: any,
  ): Promise<ResolvedDestination[]> {
    const results: ResolvedDestination[] = [];
    for (const ch of preferredChannels) {
      const res = await this.resolve(recipientType, recipientId, ch, manager);
      results.push(res);
    }
    return results;
  }
}
