import {
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_PENDING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_DISPATCHED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_SUPPRESSED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_FAILED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_REPLAYED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNELS,
  A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE,
} from '../src/policy/a7-product-notification-delivery.constants';

describe('A7 product notification delivery types (A7T06)', () => {
  it('exposes the A7 product notification delivery state constants', () => {
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_PENDING).toBe('PENDING');
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_DISPATCHED).toBe('DISPATCHED');
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_SUPPRESSED).toBe('SUPPRESSED');
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_FAILED).toBe('FAILED');
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_REPLAYED).toBe('REPLAYED');
  });

  it('exposes the A7 product notification delivery notification channel vocabulary', () => {
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNELS).toEqual(['email', 'sms', 'push', 'inApp']);
  });

  it('exposes the A7 product notification delivery internal idempotency scope', () => {
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE).toBe(
      'a7.notification-dispatch.idempotency.v1',
    );
  });
});
