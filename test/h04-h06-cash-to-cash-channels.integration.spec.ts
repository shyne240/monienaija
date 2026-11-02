import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { TestEmailProvider } from '../src/notification/email-provider.interface';
import { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { CodeNotificationEmailTemplateService } from '../src/notification/notification-email-template.service';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { NotificationTemplateService } from '../src/notification/notification-template.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('H-06 cash-to-cash channel controls (real PostgreSQL, synthetic providers)', () => {
  let ds: DataSource;
  beforeAll(async () => { ds = await createIntegrationDataSource('h0406c2c'); }, 180_000);
  afterAll(async () => { if (ds) await destroyIntegrationDataSource(ds); }, 60_000);

  it('sends an eligible claimant email independently of SMS and other events, without inventing agent email', async () => {
    const customerId = randomUUID();
    const agentId = randomUUID();
    await ds.query(`INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status)
      VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`, [customerId, `synthetic-${customerId}`]);
    await ds.query(`INSERT INTO customer_contact_methods (id,customer_id,type,value,normalized_value,is_primary,verified_at)
      VALUES ($1,$3,'PHONE','8012345678','8012345678',true,NOW()),
             ($2,$3,'EMAIL','synthetic@example.test','synthetic@example.test',true,NOW())`,
      [randomUUID(), randomUUID(), customerId]);
    await ds.query(`INSERT INTO customer_preferences (id,customer_id,language_code,theme_code,notification_email_enabled,
      notification_sms_enabled,notification_push_enabled,notification_in_app_enabled,security_login_alerts,
      security_transaction_alerts,security_device_registration_alerts,security_biometric_allowed,version)
      VALUES ($1,$2,'EN','SYSTEM',true,true,true,true,true,true,true,false,1)`, [randomUUID(), customerId]);
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=(channel='EMAIL'),version=version+1
      WHERE event_type='cash_to_cash.claimed' AND channel IN ('SMS','EMAIL')`);
    const resolver = new NotificationChannelResolverService(ds);
    const templates = new NotificationTemplateService();
    const sms = new TestNotificationProvider();
    const email = new TestEmailProvider();
    const dispatcher = new NotificationDispatcherService(ds, resolver, templates, sms, email,
      new CodeNotificationEmailTemplateService(templates));
    const payload = { claimantCustomerId: customerId, agentId, reference: 'REF-SYNTHETIC', secret: 'DO_NOT_PERSIST' };
    // Existing hyphen spelling resolves to the canonical claimed control and template.
    const claimed = await dispatcher.dispatch({ eventType: 'cash-to-cash.claimed', eventKey: `claim:${randomUUID()}`, payload });
    expect(claimed.dispatched).toBe(1);
    expect(sms.sent).toHaveLength(0);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.recipientType).toBe('CUSTOMER');
    expect(email.sent[0]?.recipientId).toBe(customerId);
    const rows = await ds.query<Array<{ recipient_type: string; channel: string; status: string; payload: unknown }>>(
      `SELECT recipient_type,channel,status,payload FROM notification_deliveries
      WHERE event_type='cash-to-cash.claimed' ORDER BY recipient_type,channel`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.recipient_type === 'AGENT' && row.channel === 'EMAIL')).toHaveLength(0);
    expect(JSON.stringify(rows)).not.toContain('DO_NOT_PERSIST');
    const expired = await dispatcher.dispatch({ eventType: 'cash_to_cash.expired', eventKey: `expiry:${randomUUID()}`,
      payload: { claimantCustomerId: customerId, reference: 'REF-SYNTHETIC' } });
    expect(expired.dispatched).toBe(1);
    expect(sms.sent).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
  });
});
