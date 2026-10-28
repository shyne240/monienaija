import { Injectable } from '@nestjs/common';

import { normalizeNigerianPhone } from '../customer-registration/phone-normalization';
import { ConfigurableSmsNotificationProvider } from './notification-provider-config.service';
import type { NotificationProvider, NotificationSendRequest, NotificationSendResult } from './notification.types';

/**
 * One boundary for ordinary deliveries, managed test sends and direct security OTPs. The
 * underlying adapter and provider-governance implementation remain owned by Arena 2.
 */
@Injectable()
export class NormalizingSmsNotificationProvider implements NotificationProvider {
  constructor(private readonly delegate: ConfigurableSmsNotificationProvider) {}

  get name(): string {
    return this.delegate.name;
  }

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (request.channel !== 'SMS') return this.delegate.send(request);
    let destination: string;
    try {
      destination = normalizeNigerianPhone(request.destination).e164;
    } catch {
      return { success: false, error: 'SMS_INVALID_DESTINATION', failureDisposition: 'PERMANENT' };
    }
    return this.delegate.send({ ...request, destination });
  }
}
