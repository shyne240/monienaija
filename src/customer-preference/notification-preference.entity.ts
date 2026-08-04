import { Column } from 'typeorm';

export class NotificationPreference {
  @Column({ name: 'notification_email_enabled', type: 'boolean', default: true })
  email!: boolean;

  @Column({ name: 'notification_sms_enabled', type: 'boolean', default: true })
  sms!: boolean;

  @Column({ name: 'notification_push_enabled', type: 'boolean', default: true })
  push!: boolean;

  @Column({ name: 'notification_in_app_enabled', type: 'boolean', default: true })
  inApp!: boolean;
}
