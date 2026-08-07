import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';
import type {
  CustomerFinancialAccountBindingMode,
  CustomerFinancialAccountBindingState,
} from './customer-financial-account-binding.enums';

export interface CustomerFinancialAccountBindingCommand {
  mappingVersion?: number;
  mode: CustomerFinancialAccountBindingMode;
  customerId: string;
  customerWalletId: string;
  currency: string;
  accountingUnit?: string;
  targetWalletAccountId?: string;
  expectedLedgerAccountId?: string;
  expectedCustomerVersion?: number;
  expectedCustomerWalletVersion?: number;
  idempotencyKey: string;
  principal: AuthorizationPrincipal;
  requestContext: RequestContext;
}

export interface CustomerFinancialAccountBindingResult {
  outcome: 'PROVISIONED_AND_BOUND' | 'BOUND_EXISTING' | 'REPLAYED';
  bindingState: CustomerFinancialAccountBindingState;
  bindingId: string;
  mappingVersion: number;
  mode: CustomerFinancialAccountBindingMode;
  customerId: string;
  customerWalletId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  currency: string;
  accountingUnit: string;
  idempotencyScope: string;
  requestHash: string;
  idempotencyReplay: boolean;
  sourceCustomerVersion: number;
  sourceCustomerWalletVersion: number;
  correlationId: string;
}

export interface NormalizedCustomerFinancialAccountBindingCommand {
  mappingVersion: 1;
  mode: CustomerFinancialAccountBindingMode;
  customerId: string;
  customerWalletId: string;
  currency: string;
  accountingUnit: 'CUSTOMER_FUNDS';
  targetWalletAccountId: string | null;
  expectedLedgerAccountId: string | null;
  expectedCustomerVersion: number | null;
  expectedCustomerWalletVersion: number | null;
  idempotencyKey: string;
  principal: AuthorizationPrincipal;
  requestContext: RequestContext;
}

export interface CustomerFinancialAccountBindingAssertion {
  customerId: string;
  customerWalletId: string;
  bindingId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  expectedCurrency: string;
  expectedAccountingUnit: 'CUSTOMER_FUNDS';
  expectedBindingVersion: number | null;
}

export type CustomerFinancialAccountBindingValidationFailureCode =
  | 'MISSING_BINDING'
  | 'IDENTITY_MISMATCH'
  | 'STALE_BINDING'
  | 'BINDING_NOT_ACTIVE'
  | 'CUSTOMER_MISSING'
  | 'CUSTOMER_NOT_ACTIVE'
  | 'CUSTOMER_WALLET_MISSING'
  | 'CUSTOMER_WALLET_NOT_ACTIVE'
  | 'WALLET_ACCOUNT_MISSING'
  | 'WALLET_ACCOUNT_NOT_ACTIVE'
  | 'LEDGER_ACCOUNT_MISSING'
  | 'LEDGER_ACCOUNT_NOT_ACTIVE'
  | 'ACCOUNT_DIMENSION_MISMATCH';

export interface CustomerFinancialAccountBindingValidationSuccess {
  valid: true;
  bindingId: string;
  customerId: string;
  customerWalletId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  bindingVersion: number;
  currency: string;
  accountingUnit: string;
}

export interface CustomerFinancialAccountBindingValidationFailure {
  valid: false;
  code: CustomerFinancialAccountBindingValidationFailureCode;
  message: string;
}

export type CustomerFinancialAccountBindingValidation =
  | CustomerFinancialAccountBindingValidationSuccess
  | CustomerFinancialAccountBindingValidationFailure;
