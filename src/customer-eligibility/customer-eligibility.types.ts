import type {
  CustomerEligibilityStatus,
  CustomerOperatingPermissionType,
  CustomerOperatingStatus,
  CustomerProductEnrollmentStatus,
  CustomerRestrictionType,
} from './customer-eligibility.enums';

export interface CreateCustomerEligibilityCommand {
  status?: CustomerEligibilityStatus;
  reason?: string;
  actor: string;
}

export interface UpdateCustomerEligibilityCommand {
  status: CustomerEligibilityStatus;
  reason?: string;
  actor: string;
  version?: number;
}

export interface CreateCustomerLimitProfileCommand {
  currency: string;
  dailyTransactionCount: number;
  dailyTransactionAmountMinor: string;
  singleTransactionAmountMinor: string;
  monthlyTransactionAmountMinor: string;
  walletBalanceMinor: string;
  actor: string;
}

export interface UpdateCustomerLimitProfileCommand {
  currency?: string;
  dailyTransactionCount?: number;
  dailyTransactionAmountMinor?: string;
  singleTransactionAmountMinor?: string;
  monthlyTransactionAmountMinor?: string;
  walletBalanceMinor?: string;
  actor: string;
  version?: number;
}

export interface CreateCustomerProductEnrollmentCommand {
  product: string;
  status?: CustomerProductEnrollmentStatus;
  reason?: string;
  actor: string;
}

export interface UpdateCustomerProductEnrollmentCommand {
  status: CustomerProductEnrollmentStatus;
  reason?: string;
  actor: string;
  version?: number;
}

export interface CreateCustomerOperatingPermissionCommand {
  type: CustomerOperatingPermissionType;
  enabled: boolean;
  reason?: string;
  actor: string;
}

export interface CreateCustomerRestrictionCommand {
  type: CustomerRestrictionType;
  isActive: boolean;
  reason?: string;
  actor: string;
}

export interface CustomerOperatingStatusView {
  customerId: string;
  status: CustomerOperatingStatus;
  canOperate: boolean;
  eligibilityStatus: CustomerEligibilityStatus | null;
  activeRestrictions: CustomerRestrictionType[];
  activeEnrollmentProducts: string[];
  enabledPermissions: CustomerOperatingPermissionType[];
  blockedReasons: string[];
}
