import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';

/** Invoked on actual journal account IDs, never caller-supplied owner claims. */
@Injectable()
export class WalletFinancialBoundaryService {
  constructor(private readonly eligibility: CustomerFinancialEligibilityService) {}

  async requireCustomerWallet(
    manager: EntityManager,
    customerId: string,
    walletId: string,
    ledgerAccountId: string,
  ): Promise<void> {
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM wallet_accounts WHERE id=$1 AND ledger_account_id=$2 AND customer_id=$3 AND owner_class='CUSTOMER' AND wallet_owner_class(customer_id)='CUSTOMER' FOR SHARE`,
      [walletId, ledgerAccountId, customerId],
    );
    if (rows.length !== 1)
      throw new ConflictException(
        'Customer wallet ownership requires review (unresolved or system-owned wallet)',
      );
    await this.eligibility.require(manager, customerId);
  }

  /** Lock the underlying obligation and bind every financial field before create or submission. */
  async requireWithdrawalOperation(
    manager: EntityManager,
    operation: {
      resourceId: string;
      walletAccountId: string;
      amountMinor: string;
      currency: string;
      id?: string;
    },
  ): Promise<void> {
    const withdrawals = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM withdrawals
       WHERE id=$1 AND wallet_id=$2 AND amount_minor=$3 AND currency=$4
         AND status IN ('PENDING', 'PROCESSING') FOR UPDATE`,
      [operation.resourceId, operation.walletAccountId, operation.amountMinor, operation.currency],
    );
    if (withdrawals.length !== 1) {
      throw new ConflictException('Withdrawal obligation does not match external operation');
    }
    const others = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM external_operations WHERE resource_type='WITHDRAWAL' AND resource_id=$1
       AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
      [operation.resourceId, operation.id ?? null],
    );
    if (others.length !== 0) {
      throw new ConflictException('Withdrawal already has an external operation');
    }
  }

  async requireAccounts(manager: EntityManager, accountIds: string[]): Promise<void> {
    const rows = await manager.query<
      Array<{ customer_id: string; owner_class: string; current_class: string }>
    >(
      `SELECT customer_id,owner_class,wallet_owner_class(customer_id) AS current_class
         FROM wallet_accounts WHERE ledger_account_id = ANY($1::uuid[]) ORDER BY customer_id`,
      [accountIds],
    );
    for (const row of rows) {
      // Platform-custody wallets are never a customer/agent financial lane: they exist for
      // reconciliation of an ambiguous historical owner and hold no claimable customer money.
      if (row.owner_class === 'SYSTEM')
        throw new ConflictException(
          'System-owned wallet is not eligible for customer or agent financial operations',
        );
      if (row.owner_class !== row.current_class || row.owner_class === 'REVIEW')
        throw new ConflictException('Wallet ownership requires review');
      if (row.owner_class === 'CUSTOMER')
        await this.eligibility.require(manager, row.customer_id.toLowerCase());
      else if (row.owner_class === 'AGENT') {
        const active = await manager.query<Array<{ id: string }>>(
          "SELECT id FROM agents WHERE id=$1::uuid AND status='ACTIVE' AND deleted_at IS NULL FOR SHARE",
          [row.customer_id],
        );
        if (active.length !== 1) throw new ConflictException('Agent wallet owner is not active');
      } else throw new ConflictException('Wallet ownership requires review');
    }
  }
}
