import { runWithSystemContext } from '../../src/authorization/authorization-context';
import type { AuthorizationPrincipal } from '../../src/authorization/authorization.types';

export const integrationSystemPrincipal: AuthorizationPrincipal = {
  type: 'SERVICE',
  principalId: 'integration-test',
  roles: [],
  scopes: [
    'ledger:write',
    'ledger:reverse',
    'transfer:create',
    'deposit:create',
    'deposit:complete',
    'deposit:manage',
    'withdrawal:create',
    'withdrawal:complete',
    'withdrawal:manage',
    'finance:execute',
  ],
  customerAccess: 'ANY',
  assuranceLevel: 'MFA',
};

export const integrationMockCommandGate = {
  authorize: async () => ({ allowed: true, authorization: {} as any }),
  computeActionFingerprint: () => 'a'.repeat(64),
  consumeApproval: async () => ({ approved: true }),
} as any;

export const integrationMockMakerCheckerPolicy = {
  checkRequirement: async () => ({ required: false, reason: 'POLICY_ALLOWS_SINGLE_PARTY' }),
} as any;

export const integrationMockDepositGate = {
  validate: async () => ({ status: 'ALLOWED' }),
} as any;

export const integrationMockWithdrawalGate = {
  validate: async () => ({ status: 'ALLOWED' }),
} as any;

export const integrationMockInternalTransferGate = {
  validate: async () => ({ status: 'PASSED' }),
} as any;

/**
 * Wraps a ledger service so that all mutating methods automatically run with system context.
 * This is needed because integration tests call ledger methods directly without HTTP context.
 */
export function wrapLedgerForIntegration(ledger: any): any {
  const principal = integrationSystemPrincipal;
  const methodNames = [
    'createAccount',
    'postJournal',
    'postJournalInTransaction',
    'reverseJournal',
    'getAccount',
    'getAccountBalance',
    'getAccountBalances',
    'listAccounts',
    'getJournal',
  ];
  
  for (const methodName of methodNames) {
    if (typeof ledger[methodName] === 'function') {
      const original = ledger[methodName].bind(ledger);
      ledger[methodName] = (...args: any[]) =>
        runWithSystemContext(`integration-test:${methodName}`, () => original(...args), principal);
    }
  }
  return ledger;
}

/**
 * Wraps deposit/withdrawal/transfer services so that all mutating methods run with system context.
 */
export function wrapFinancialService(service: any, methodNames: string[]): any {
  const principal = integrationSystemPrincipal;
  for (const method of methodNames) {
    if (typeof service[method] === 'function') {
      const original = service[method].bind(service);
      service[method] = (...args: any[]) =>
        runWithSystemContext(`integration-test:${method}`, () => original(...args), principal);
    }
  }
  return service;
}
