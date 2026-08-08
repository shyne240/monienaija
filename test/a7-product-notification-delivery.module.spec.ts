import { A7ProductNotificationDeliveryModule } from '../src/policy/a7-product-notification-delivery.module';
import { A7ProductNotificationDeliveryRepository } from '../src/policy/a7-product-notification-delivery.repository';
import { A7ProductNotificationDeliveryService } from '../src/policy/a7-product-notification-delivery.service';
import { A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDERS } from '../src/policy/a7-product-notification-delivery.module';

describe('A7T06 A7 product notification delivery NestJS module', () => {
  it('exposes the A7 product notification delivery providers as a frozen array', () => {
    expect(Object.isFrozen(A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDERS)).toBe(true);
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDERS).toContain(
      A7ProductNotificationDeliveryRepository,
    );
    expect(A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDERS).toContain(
      A7ProductNotificationDeliveryService,
    );
  });

  it('exposes the A7 product notification delivery module class', () => {
    expect(typeof A7ProductNotificationDeliveryModule).toBe('function');
  });

  it('exposes the A7 product notification delivery repository class', () => {
    expect(typeof A7ProductNotificationDeliveryRepository).toBe('function');
  });

  it('exposes the A7 product notification delivery service class', () => {
    expect(typeof A7ProductNotificationDeliveryService).toBe('function');
  });
});
