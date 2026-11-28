import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { BankingVirtualAccountService } from '../src/banking/banking-virtual-account.service';
import { BankingProviderRegistry, capabilitiesOf } from '../src/banking/banking-provider.registry';
import type {
  BankingProvider,
  BankingProviderResult,
  VirtualAccountProvisionResult,
  VirtualAccountStatusResult,
} from '../src/banking/banking-provider.types';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Acceptance for virtual-account provisioning.
 *
 * The failure mode that matters: a timeout on provisioning. The account may well exist at the bank.
 * If the system reacts by provisioning again, the customer ends up with two NUBANs — and one of them
 * will keep receiving money that nobody is reconciling. So the assertions below are mostly about
 * what the service refuses to do.
 */
describe('banking virtual account service (real PostgreSQL)', () => {
  let db: DataSource;
  let service: BankingVirtualAccountService;
  let institutionId: string;
  let walletId: string;
  let sharedLedgerAccountId: string;
  let provisionCalls: number;
  let provisionImpl: () => Promise<BankingProviderResult<VirtualAccountProvisionResult>>;
  let statusImpl: () => Promise<BankingProviderResult<VirtualAccountStatusResult>>;

  const CORRELATION = 'corr-va-1';

  function command(over: Record<string, unknown> = {}) {
    return {
      institutionId,
      walletId,
      providerKey: 'MONNIFY',
      environment: 'sandbox' as const,
      accountReference: `MN${`${Date.now()}${randomUUID().replace(/\D/g, '')}`.slice(0, 20)}`,
      accountName: 'Test Reserved Account',
      customerName: 'John Doe',
      customerEmail: 'john@example.test',
      currency: 'NGN',
      correlationId: CORRELATION,
      ...over,
    };
  }

  const provisioned = (accountNumber = '6254727989') =>
    Promise.resolve({
      ok: true,
      value: {
        outcome: 'PROVISIONED',
        accountReference: 'ignored',
        providerReference: 'NWA7DMJ0W2UDK1KN5SLF',
        accounts: [
          {
            bankName: 'Moniepoint Microfinance Bank',
            providerBankCode: '50515',
            accountNumber,
            accountName: 'Test Reserved Account',
          },
        ],
        currency: 'NGN',
        correlationId: CORRELATION,
      },
    } as BankingProviderResult<VirtualAccountProvisionResult>);

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkva0001');
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Virtual account fixture','PARTNER','fixture')`,
      [institutionId, `BKVA-${suffix}`, `BKVA_${suffix}`],
    );
    sharedLedgerAccountId = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'VA fixture','LIABILITY','CREDIT','NGN')`,
      [sharedLedgerAccountId, `VA_FIXTURE_${suffix}`],
    );
    walletId = randomUUID();
    await db.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id)
       VALUES ($1,$2,'NGN','ACTIVE',$3)`,
      [walletId, `cust-${suffix}`, sharedLedgerAccountId],
    );

    const provider = {
      descriptor: {
        key: 'MONNIFY',
        displayName: 'Monnify',
        environment: 'sandbox',
        capabilities: capabilitiesOf({
          VIRTUAL_ACCOUNT_PROVISION: true,
          VIRTUAL_ACCOUNT_STATUS: true,
        }),
        descriptors: [],
      },
      provisionVirtualAccount: async () => {
        provisionCalls += 1;
        return provisionImpl();
      },
      getVirtualAccountStatus: async () => statusImpl(),
    } as BankingProvider;
    const registry = new BankingProviderRegistry();
    registry.register(provider);
    service = new BankingVirtualAccountService(db, registry);
  }, 120000);

  /** Creates a real wallet; the reservation table's foreign key is not something to work around. */
  async function newWallet(): Promise<string> {
    const wallet = randomUUID();
    // Each wallet needs its own ledger account: `uq_wallet_accounts_ledger_account` is unique.
    const ledger = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'VA wallet ledger','LIABILITY','CREDIT','NGN')`,
      [ledger, `VA_WALLET_${wallet.replace(/-/g, '').slice(0, 20)}`],
    );
    await db.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id)
       VALUES ($1,$2,'NGN','ACTIVE',$3)`,
      [wallet, `cust-${wallet.slice(0, 8)}`, ledger],
    );
    return wallet;
  }

  beforeEach(() => {
    provisionCalls = 0;
    provisionImpl = () => provisioned();
    statusImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'ACTIVE',
          accountReference: 'x',
          accounts: [
            {
              bankName: 'Moniefic',
              providerBankCode: '50515',
              accountNumber: '6254727989',
              accountName: 'Test',
            },
          ],
          correlationId: CORRELATION,
        },
      } as BankingProviderResult<VirtualAccountStatusResult>);
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('provisions and returns only the account numbers the provider issued', async () => {
    const result = await service.provision(command());
    expect(result.outcome).toBe('PROVISIONED');
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]!.accountNumber).toBe('6254727989');
    expect(provisionCalls).toBe(1);
  });

  it('returns the existing reservation instead of provisioning twice for the same reference', async () => {
    const cmd = command();
    await service.provision(cmd);
    const second = await service.provision(cmd);
    expect(second.outcome).toBe('ALREADY_PROVISIONED');
    expect(provisionCalls).toBe(1);
  });

  it('records a timeout as UNKNOWN and BLOCKS a second provisioning attempt', async () => {
    const first = await service.provision(command());
    provisionImpl = () => Promise.reject(new Error('Timeout'));
    // Re-provision to reach the throwing implementation, then assert the block.
    const unknown = await service.provision(
      command({ accountReference: `VA-${randomUUID().slice(0, 18)}` }),
    );
    expect(unknown.outcome).toBe('UNKNOWN');
    expect(unknown.unknownPending).toBe(true);
    expect(first.outcome).toBe('PROVISIONED');

    const callsAfterUnknown = provisionCalls;
    // Now attempt provisioning again for the same wallet: it must be blocked, not submitted.
    const blocked = await service.provision(command());
    expect(blocked.outcome).toBe('UNKNOWN');
    expect(blocked.unknownPending).toBe(true);
    expect(provisionCalls).toBe(callsAfterUnknown);
    expect(blocked.accounts).toHaveLength(0);
  });

  it('shows no account number when provisioning is only PENDING', async () => {
    provisionImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'PENDING',
          accountReference: 'x',
          accounts: [],
          correlationId: CORRELATION,
        },
      } as BankingProviderResult<VirtualAccountProvisionResult>);
    const result = await service.provision(command({ walletId: await newWallet() }));
    expect(result.outcome).toBe('PENDING');
    // A pending provision has no NUBAN, so nothing may be shown to a customer.
    expect(result.accounts).toHaveLength(0);
  });

  it('treats an explicit rejection as REJECTED, distinct from UNKNOWN', async () => {
    provisionImpl = () =>
      Promise.resolve({
        ok: false,
        error: {
          category: 'PROVIDER_REJECTED',
          code: 'MONNIFY_REJECTED',
          detail: 'customer not eligible',
        },
      } as BankingProviderResult<VirtualAccountProvisionResult>);
    const result = await service.provision(command({ walletId: await newWallet() }));
    expect(result.outcome).toBe('REJECTED');
    // REJECTED is not uncertain: the customer may retry with corrected details.
    expect(result.unknownPending).toBe(false);
  });

  it('treats a transport failure as UNKNOWN, not REJECTED', async () => {
    provisionImpl = () =>
      Promise.resolve({
        ok: false,
        error: { category: 'TRANSPORT', code: 'MONNIFY_TRANSPORT_FAILED', detail: 'reset' },
      } as BankingProviderResult<VirtualAccountProvisionResult>);
    const result = await service.provision(command({ walletId: await newWallet() }));
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('resolves an UNKNOWN reservation by enquiry, without submitting again', async () => {
    provisionImpl = () => Promise.reject(new Error('Timeout'));
    const unknown = await service.provision(command({ walletId: await newWallet() }));
    expect(unknown.outcome).toBe('UNKNOWN');
    const callsBefore = provisionCalls;

    const resolved = await service.enquire(unknown.reservationId, CORRELATION);
    expect(resolved.outcome).toBe('PROVISIONED');
    expect(resolved.accounts[0]!.accountNumber).toBe('6254727989');
    // Enquiry must never submit.
    expect(provisionCalls).toBe(callsBefore);
  });

  it('does not invent an account number when the provider reports none', async () => {
    statusImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'NOT_FOUND',
          accountReference: 'x',
          accounts: [],
          correlationId: CORRELATION,
        },
      } as BankingProviderResult<VirtualAccountStatusResult>);
    provisionImpl = () => Promise.reject(new Error('Timeout'));
    const unknown = await service.provision(command({ walletId: await newWallet() }));
    const resolved = await service.enquire(unknown.reservationId, CORRELATION);
    expect(resolved.accounts).toHaveLength(0);
    expect(resolved.outcome).toBe('UNKNOWN');
  });
});
