import { FINANCIAL_NOTIFICATION_EVENT_TYPES } from '../src/notification/notification-defaults-v2';
import { appendCustomerEmailIntents, mapEventToIntents, NOTIFICATION_EVENT_CATALOGUE } from '../src/notification/notification-event-map';
import { isSecurityCriticalNotificationEvent } from '../src/notification/notification-security.constants';
import { canonicalNotificationEvent } from '../src/notification/notification-template.service';

const customerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const agentId = '33333333-3333-4333-8333-333333333333';
const payload = { customerId, sourceCustomerId: customerId, destinationCustomerId: otherId,
  claimantCustomerId: customerId, agentId, beneficiaryPhone: '8012345678' };
const context = { correlationId: null, causationId: null };

describe('H-04/H-06 financial notification catalogue and channel mapping', () => {
  it.each(FINANCIAL_NOTIFICATION_EVENT_TYPES)('%s is configurable rather than mandatory or security classified', (eventType) => {
    expect(NOTIFICATION_EVENT_CATALOGUE.find((entry) => entry.eventType === eventType)?.required).toBe(false);
    expect(isSecurityCriticalNotificationEvent(eventType)).toBe(false);
  });

  it.each(FINANCIAL_NOTIFICATION_EVENT_TYPES.filter((eventType) => eventType !== 'cash_to_cash.created'))(
    '%s permits an EMAIL copy for each eligible customer without inventing agent email',
    (eventType) => {
      const sms = mapEventToIntents(eventType, payload, context);
      const withEmail = appendCustomerEmailIntents(eventType, sms);
      const customers = sms.filter((intent) => intent.recipientType === 'CUSTOMER' && intent.channel === 'SMS');
      expect(customers.length).toBeGreaterThan(0);
      expect(withEmail.filter((intent) => intent.channel === 'EMAIL')).toEqual(
        customers.map((intent) => ({ ...intent, channel: 'EMAIL' })),
      );
      expect(withEmail.filter((intent) => intent.recipientType !== 'CUSTOMER' && intent.channel === 'EMAIL')).toEqual([]);
    },
  );

  it('keeps phone-only cash-to-cash creation on SMS without inventing an email recipient', () => {
    const intents = mapEventToIntents('cash_to_cash.created', payload, context);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ recipientType: 'PHONE', channel: 'SMS' });
    expect(appendCustomerEmailIntents('cash_to_cash.created', intents)).toEqual(intents);
  });

  it.each(['claimed', 'expired'])('keeps cash-to-cash %s spelling aliases on the canonical event control', (outcome) => {
    const alias = `cash-to-cash.${outcome}`;
    const canonical = `cash_to_cash.${outcome}`;
    expect(canonicalNotificationEvent(alias)).toBe(canonical);
    const intents = mapEventToIntents(alias, payload, context);
    expect(intents.every((intent) => intent.templateKey === canonical)).toBe(true);
    expect(appendCustomerEmailIntents(alias, intents).some((intent) => intent.channel === 'EMAIL')).toBe(true);
  });

  it('keeps transfer unknown independent from failed', () => {
    expect(canonicalNotificationEvent('transfer.unknown')).toBe('transfer.unknown');
    expect(mapEventToIntents('transfer.unknown', payload, context)[0]?.templateKey).toBe('transfer.unknown');
  });
});
