import { A7ProductCustomerBindingRepository } from '../src/policy/a7-product-customer-binding.repository';
import type {
  A7ProductCustomerBindingConsumerPorts,
  A7ProductCustomerBindingVirtualAccountEvidence,
} from '../src/policy/a7-product-customer-binding.types';
import type { CustomerFinancialAccountBindingService } from '../src/wallet/customer-financial-account-binding.service';
import type { CustomerFinancialAccountBindingValidation } from '../src/wallet/customer-financial-account-binding.types';
import type { VirtualAccountService } from '../src/virtual-account/virtual-account.service';
import type { VirtualAccountView } from '../src/virtual-account/virtual-account.types';
import { VirtualAccountStatus } from '../src/virtual-account/virtual-account.enums';
import type { PartnerConnectionService } from '../src/partner/partner-connection.service';
import type { BankService } from '../src/bank/bank.service';
import { BankStatus } from '../src/bank/bank.enums';
import type { AuditService } from '../src/operations/audit.service';
import type { AuditEvent } from '../src/operations/audit-event.entity';
import type { DataSource } from 'typeorm';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const BINDING_ID = '00000000-0000-4000-8000-000000000003';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000005';
const VIRTUAL_ACCOUNT_ID = '00000000-0000-4000-8000-000000000006';
const REQUEST_ID = 'request-rcb-1';
const CORRELATION_ID = 'correlation-rcb-1';

class FakeBindingService {
  valid = true;
  code: 'IDENTITY_MISMATCH' | 'A3_BINDING_MISSING' | 'A3_BINDING_NOT_ACTIVE' = 'IDENTITY_MISMATCH';
  message = '';

  validateActiveBinding(assertion: unknown): Promise<CustomerFinancialAccountBindingValidation> {
    void assertion;
    if (!this.valid) {
      return Promise.resolve({
        valid: false,
        code: this.code as CustomerFinancialAccountBindingValidation extends {
          valid: false;
          code: infer C;
        }
          ? C
          : never,
        message: this.message,
      });
    }
    return Promise.resolve({
      valid: true,
      bindingId: BINDING_ID,
      customerId: CUSTOMER_ID,
      customerWalletId: CUSTOMER_WALLET_ID,
      walletAccountId: WALLET_ACCOUNT_ID,
      ledgerAccountId: LEDGER_ACCOUNT_ID,
      bindingVersion: 1,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
  }
}

class FakeVirtualAccountService {
  view: VirtualAccountView | null = null;

  get(): Promise<VirtualAccountView> {
    if (!this.view) {
      return Promise.reject(new Error('not found'));
    }
    return Promise.resolve(this.view);
  }

  lookup(): Promise<VirtualAccountView> {
    if (!this.view) {
      return Promise.reject(new Error('not found'));
    }
    return Promise.resolve(this.view);
  }
}

class FakePartnerConnectionService {
  enabled = true;
  baseUrl: string | null = 'https://partner.example.com';
  getProfile() {
    return {
      enabled: this.enabled,
      nodeEnvironment: 'sandbox' as const,
      partnerKey: 'NIBSS_NIP' as const,
      capabilityKey: 'external.wallet.withdrawal.settlement' as const,
      operationType: 'OUTBOUND_BANK_SETTLEMENT' as const,
      environment: 'sandbox' as const,
      apiVersion: 'v1',
      adapterVersion: '1.0.0',
      baseUrl: this.baseUrl,
      credentialReference: null,
      signingKeyReference: null,
      signingAlgorithm: 'HMAC_SHA256' as const,
      requestTimeoutMs: 30000,
      connectTimeoutMs: 10000,
    };
  }
}

class FakeBankService {
  banks: Array<{
    bankCode: string;
    bankName: string;
    shortName: string;
    nipSupported: boolean;
    status: BankStatus;
  }> = [
    {
      bankCode: '999',
      bankName: 'Test Bank',
      shortName: 'TestBank',
      nipSupported: true,
      status: BankStatus.ACTIVE,
    },
  ];
  list(): Promise<
    Array<{
      bankCode: string;
      bankName: string;
      shortName: string;
      nipSupported: boolean;
      status: BankStatus;
    }>
  > {
    return Promise.resolve(this.banks);
  }
}

class FakeAuditService {
  recorded: Array<{
    manager: unknown;
    command: Parameters<AuditService['record']>[1];
  }> = [];
  fail = false;
  record(
    manager: Parameters<AuditService['record']>[0],
    command: Parameters<AuditService['record']>[1],
  ): Promise<AuditEvent> {
    if (this.fail) {
      return Promise.reject(new Error('audit failed'));
    }
    this.recorded.push({ manager, command });
    return Promise.resolve({} as AuditEvent);
  }
}

class FakeDataSource {
  transactions: Array<{ callback: (manager: unknown) => Promise<unknown> }> = [];
  transaction<T>(callback: (manager: unknown) => Promise<T>): Promise<T> {
    this.transactions.push({ callback: callback as (manager: unknown) => Promise<unknown> });
    return callback({} as unknown);
  }
}

function makeRepository() {
  const bindingService = new FakeBindingService();
  const virtualAccountService = new FakeVirtualAccountService();
  const partnerConnectionService = new FakePartnerConnectionService();
  const bankService = new FakeBankService();
  const auditService = new FakeAuditService();
  const dataSource = new FakeDataSource();
  const repository = new A7ProductCustomerBindingRepository(
    bindingService as unknown as CustomerFinancialAccountBindingService,
    virtualAccountService as unknown as VirtualAccountService,
    partnerConnectionService as unknown as PartnerConnectionService,
    bankService as unknown as BankService,
    auditService as unknown as AuditService,
    dataSource as unknown as DataSource,
  );
  return {
    repository,
    bindingService,
    virtualAccountService,
    partnerConnectionService,
    bankService,
    auditService,
    dataSource,
  };
}

describe('A7T04 A4 product customer-binding read-only consumer repository', () => {
  it('exposes the A7 product customer-binding consumer ports', () => {
    const { repository } = makeRepository();
    const ports = repository.getConsumerPorts();
    expect(typeof ports.a3BindingRecheck).toBe('function');
    expect(typeof ports.virtualAccountLookup).toBe('function');
    expect(typeof ports.virtualAccountLookupByProviderAndNumber).toBe('function');
    expect(typeof ports.a4ProductPolicyDecisionLookup).toBe('function');
    expect(typeof ports.a2AuthorizationContextLookup).toBe('function');
    expect(typeof ports.a6T04FundingTargetLookup).toBe('function');
    expect(typeof ports.bankDirectoryLookup).toBe('function');
    expect(typeof ports.operationsAudit).toBe('function');
  });

  it('rechecks an active A3 binding through the A3 binding service', async () => {
    const { repository } = makeRepository();
    const ports: A7ProductCustomerBindingConsumerPorts = repository.getConsumerPorts();
    const outcome = await ports.a3BindingRecheck({
      customerId: CUSTOMER_ID,
      customerWalletId: CUSTOMER_WALLET_ID,
      bindingId: BINDING_ID,
      bindingVersion: 1,
      walletAccountId: WALLET_ACCOUNT_ID,
      ledgerAccountId: LEDGER_ACCOUNT_ID,
      expectedCurrency: 'NGN',
      expectedAccountingUnit: 'CUSTOMER_FUNDS',
      expectedBindingVersion: 1,
    });
    expect(outcome.valid).toBe(true);
    if (outcome.valid) {
      expect(outcome.bindingId).toBe(BINDING_ID);
      expect(outcome.customerWalletId).toBe(CUSTOMER_WALLET_ID);
      expect(outcome.walletAccountId).toBe(WALLET_ACCOUNT_ID);
      expect(outcome.ledgerAccountId).toBe(LEDGER_ACCOUNT_ID);
    }
  });

  it('fails closed for a missing A3 binding', async () => {
    const { repository, bindingService } = makeRepository();
    bindingService.valid = false;
    bindingService.code = 'A3_BINDING_MISSING';
    bindingService.message = 'missing';
    const ports = repository.getConsumerPorts();
    const outcome = await ports.a3BindingRecheck({
      customerId: CUSTOMER_ID,
      customerWalletId: CUSTOMER_WALLET_ID,
      bindingId: BINDING_ID,
      bindingVersion: 1,
      walletAccountId: WALLET_ACCOUNT_ID,
      ledgerAccountId: LEDGER_ACCOUNT_ID,
      expectedCurrency: 'NGN',
      expectedAccountingUnit: 'CUSTOMER_FUNDS',
      expectedBindingVersion: 1,
    });
    expect(outcome.valid).toBe(false);
    if (!outcome.valid) {
      expect(outcome.code).toBe('A3_BINDING_MISSING');
    }
  });

  it('looks up a virtual-account row by id through the existing module', async () => {
    const { repository, virtualAccountService } = makeRepository();
    virtualAccountService.view = {
      id: VIRTUAL_ACCOUNT_ID,
      walletId: CUSTOMER_WALLET_ID,
      bankCode: '999',
      accountNumber: '0123456789',
      accountName: 'TEST ACCOUNT',
      provider: 'NIBSS_NIP',
      status: VirtualAccountStatus.ACTIVE,
      reference: 'va-ref-1',
      assignedAt: new Date(),
      deactivatedAt: null,
    };
    const ports = repository.getConsumerPorts();
    const evidence = await ports.virtualAccountLookup(VIRTUAL_ACCOUNT_ID);
    expect(evidence).toBeDefined();
    if (evidence) {
      expect(evidence.virtualAccountId).toBe(VIRTUAL_ACCOUNT_ID);
      expect(evidence.walletId).toBe(CUSTOMER_WALLET_ID);
      expect(evidence.status).toBe('ACTIVE');
    }
  });

  it('returns null for a missing virtual-account row', async () => {
    const { repository, virtualAccountService } = makeRepository();
    virtualAccountService.view = null;
    const ports = repository.getConsumerPorts();
    const evidence = await ports.virtualAccountLookup(VIRTUAL_ACCOUNT_ID);
    expect(evidence).toBeNull();
  });

  it('looks up a virtual-account row by (provider, accountNumber) through the existing module', async () => {
    const { repository, virtualAccountService } = makeRepository();
    virtualAccountService.view = {
      id: VIRTUAL_ACCOUNT_ID,
      walletId: CUSTOMER_WALLET_ID,
      bankCode: '999',
      accountNumber: '0123456789',
      accountName: 'TEST ACCOUNT',
      provider: 'NIBSS_NIP',
      status: VirtualAccountStatus.ACTIVE,
      reference: 'va-ref-1',
      assignedAt: new Date(),
      deactivatedAt: null,
    };
    const ports = repository.getConsumerPorts();
    const evidence: A7ProductCustomerBindingVirtualAccountEvidence | null =
      await ports.virtualAccountLookupByProviderAndNumber('NIBSS_NIP', '0123456789');
    expect(evidence).toBeDefined();
    if (evidence) {
      expect(evidence.provider).toBe('NIBSS_NIP');
      expect(evidence.accountNumber).toBe('0123456789');
    }
  });

  it('looks up an A4 product-policy decision through the A4 product-policy authority', async () => {
    const { repository } = makeRepository();
    const ports = repository.getConsumerPorts();
    const decision = await ports.a4ProductPolicyDecisionLookup('a4-decision-1');
    expect(decision).toBeDefined();
    if (decision) {
      expect(decision.productKey).toBe('VIRTUAL_ACCOUNT');
      expect(decision.decision).toBe('ALLOW_WITH_LIMITS');
    }
  });

  it('returns null for an invalid A4 product-policy decision reference', async () => {
    const { repository } = makeRepository();
    const ports = repository.getConsumerPorts();
    const decision = await ports.a4ProductPolicyDecisionLookup('!!invalid!!');
    expect(decision).toBeNull();
  });

  it('looks up an A2 authorization context through the A2 authorization authority', async () => {
    const { repository } = makeRepository();
    const ports = repository.getConsumerPorts();
    const a2 = await ports.a2AuthorizationContextLookup('a2-auth-1');
    expect(a2).toBeDefined();
    if (a2) {
      expect(a2.allowed).toBe(true);
    }
  });

  it('returns null for an invalid A2 authorization context reference', async () => {
    const { repository } = makeRepository();
    const ports = repository.getConsumerPorts();
    const a2 = await ports.a2AuthorizationContextLookup('!!invalid!!');
    expect(a2).toBeNull();
  });

  it('looks up the A6T04 funding-target evidence through the A6T04 consumer', async () => {
    const { repository } = makeRepository();
    const ports = repository.getConsumerPorts();
    const a6T04 = await ports.a6T04FundingTargetLookup(CUSTOMER_ID, 'va-ref-1');
    expect(a6T04).toBeDefined();
    if (a6T04) {
      expect(a6T04.targetCurrency).toBe('NGN');
      expect(a6T04.consentPurpose).toBe('OUTBOUND_BANK_SETTLEMENT');
    }
  });

  it('returns null for a missing A6T04 funding-target reference', async () => {
    const { repository } = makeRepository();
    const ports = repository.getConsumerPorts();
    expect(await ports.a6T04FundingTargetLookup(CUSTOMER_ID, '')).toBeNull();
    expect(await ports.a6T04FundingTargetLookup('', '')).toBeNull();
  });

  it('looks up a bank directory entry through the existing bank service', async () => {
    const { repository } = makeRepository();
    const ports = repository.getConsumerPorts();
    const bank = await ports.bankDirectoryLookup('999');
    expect(bank).toBeDefined();
    if (bank) {
      expect(bank.nipSupported).toBe(true);
      expect(bank.status).toBe('ACTIVE');
    }
  });

  it('returns null for a missing bank directory entry', async () => {
    const { repository, bankService } = makeRepository();
    bankService.banks = [];
    const ports = repository.getConsumerPorts();
    expect(await ports.bankDirectoryLookup('999')).toBeNull();
  });

  it('returns null for a non-NIP-supported bank', async () => {
    const { repository, bankService } = makeRepository();
    bankService.banks = [
      {
        bankCode: '888',
        bankName: 'Test',
        shortName: 'Test',
        nipSupported: false,
        status: BankStatus.ACTIVE,
      },
    ];
    const ports = repository.getConsumerPorts();
    expect(await ports.bankDirectoryLookup('888')).toBeNull();
  });

  it('returns null when the bank service throws', async () => {
    const { repository, bankService } = makeRepository();
    (bankService as unknown as { list: () => Promise<never> }).list = () =>
      Promise.reject(new Error('boom'));
    const ports = repository.getConsumerPorts();
    expect(await ports.bankDirectoryLookup('999')).toBeNull();
  });

  it('returns the A6 partner connection status through the A6 partner boundary', () => {
    const { repository } = makeRepository();
    const status = repository.getA6PartnerConnectionStatus();
    expect(status.enabled).toBe(true);
    expect(status.partnerKey).toBe('NIBSS_NIP');
    expect(status.environment).toBe('sandbox');
  });

  it('returns the A6 partner connection status as disabled when the A6 partner is disabled', () => {
    const { repository, partnerConnectionService } = makeRepository();
    partnerConnectionService.enabled = false;
    const status = repository.getA6PartnerConnectionStatus();
    expect(status.enabled).toBe(false);
  });

  it('validates the A6 partner reference shape', () => {
    const { repository } = makeRepository();
    expect(repository.validateA6PartnerReferenceShape('OPERATION', 'value-1', 'ns-1')).toBe(true);
    expect(repository.validateA6PartnerReferenceShape('OPERATION', '!invalid!', 'ns-1')).toBe(
      false,
    );
    expect(repository.validateA6PartnerReferenceShape('OPERATION', 'value-1', '!invalid!')).toBe(
      false,
    );
    expect(repository.validateA6PartnerReferenceShape('', 'value-1', 'ns-1')).toBe(false);
  });

  it('records the A7 product customer-binding verified audit fact through a transaction', async () => {
    const { repository, auditService, dataSource } = makeRepository();
    await repository.recordVerifiedAudit(
      'a7-map-ref-1',
      { requestId: REQUEST_ID, correlationId: CORRELATION_ID, traceId: 'trace-1' },
      { test: true },
    );
    expect(auditService.recorded).toHaveLength(1);
    expect(dataSource.transactions).toHaveLength(1);
  });

  it('fails closed when the audit service throws', async () => {
    const { repository, auditService } = makeRepository();
    auditService.fail = true;
    await expect(
      repository.recordVerifiedAudit(
        'a7-map-ref-1',
        { requestId: REQUEST_ID, correlationId: CORRELATION_ID, traceId: 'trace-1' },
        { test: true },
      ),
    ).rejects.toThrow('audit failed');
  });
});
