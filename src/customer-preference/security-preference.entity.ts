import { Column } from 'typeorm';

export class SecurityPreference {
  @Column({ name: 'security_login_alerts', type: 'boolean', default: true })
  loginAlerts!: boolean;

  @Column({ name: 'security_transaction_alerts', type: 'boolean', default: true })
  transactionAlerts!: boolean;

  @Column({ name: 'security_device_registration_alerts', type: 'boolean', default: true })
  deviceRegistrationAlerts!: boolean;

  @Column({ name: 'security_biometric_allowed', type: 'boolean', default: false })
  biometricAllowed!: boolean;
}
