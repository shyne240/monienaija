import type {
  CustomerLanguage,
  CustomerTheme,
  PreferenceHistoryAction,
} from './customer-preference.enums';

export interface NotificationPreferenceCommand {
  email: boolean;
  sms: boolean;
  push: boolean;
  inApp: boolean;
}

export interface SecurityPreferenceCommand {
  loginAlerts: boolean;
  transactionAlerts: boolean;
  deviceRegistrationAlerts: boolean;
  biometricAllowed: boolean;
}

export interface CreateCustomerPreferenceCommand {
  language: CustomerLanguage;
  theme: CustomerTheme;
  notifications: NotificationPreferenceCommand;
  security: SecurityPreferenceCommand;
  actor: string;
}

export interface UpdateNotificationPreferenceCommand {
  email?: boolean;
  sms?: boolean;
  push?: boolean;
  inApp?: boolean;
}

export interface UpdateSecurityPreferenceCommand {
  loginAlerts?: boolean;
  transactionAlerts?: boolean;
  deviceRegistrationAlerts?: boolean;
  biometricAllowed?: boolean;
}

export interface UpdateCustomerPreferenceCommand {
  language?: CustomerLanguage;
  theme?: CustomerTheme;
  notifications?: UpdateNotificationPreferenceCommand;
  security?: UpdateSecurityPreferenceCommand;
  actor: string;
  version?: number;
}

export interface CustomerPreferenceView {
  id: string;
  customerId: string;
  language: CustomerLanguage;
  theme: CustomerTheme;
  notifications: NotificationPreferenceCommand;
  security: SecurityPreferenceCommand;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PreferenceHistoryView {
  id: string;
  preferenceId: string;
  action: PreferenceHistoryAction;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  actor: string;
  createdAt: Date;
}
