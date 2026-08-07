import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';
import type { CustomerFinancialAccountReconciliationReport } from '../reconciliation/customer-financial-account-reconciliation.types';
import type { CustomerFinancialAccountBindingState } from './customer-financial-account-binding.enums';
import type { CustomerFinancialAccountBindingRepairAction } from './customer-financial-account-binding-repair.enums';

export interface CustomerFinancialAccountBindingRepairCommand {
  action: CustomerFinancialAccountBindingRepairAction;
  bindingId: string;
  approvalId: string;
  actionFingerprint: string;
  reason: string;
  idempotencyKey: string;
  expectedBindingVersion?: number;
  principal: AuthorizationPrincipal;
  requestContext: RequestContext;
}

export interface NormalizedCustomerFinancialAccountBindingRepairCommand {
  action: CustomerFinancialAccountBindingRepairAction;
  bindingId: string;
  approvalId: string;
  actionFingerprint: string;
  reason: string;
  idempotencyKey: string;
  expectedBindingVersion: number | null;
  principal: AuthorizationPrincipal;
  requestContext: RequestContext;
}

export interface CustomerFinancialAccountBindingRepairResult {
  outcome: 'REPAIRED_TO_PENDING' | 'CLOSED' | 'REPLAYED';
  action: CustomerFinancialAccountBindingRepairAction;
  bindingId: string;
  customerId: string;
  customerWalletId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  previousState: CustomerFinancialAccountBindingState;
  state: CustomerFinancialAccountBindingState;
  version: number;
  idempotencyScope: string;
  requestHash: string;
  idempotencyReplay: boolean;
  reconciliationBefore: Pick<CustomerFinancialAccountReconciliationReport, 'status'> & {
    discrepancies: number;
  };
  correlationId: string;
  reconciliationAfter?: Pick<CustomerFinancialAccountReconciliationReport, 'status'> & {
    discrepancies: number;
  };
}
