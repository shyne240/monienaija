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
    if (rows.length !== 1) throw new ConflictException('Customer wallet ownership requires review');
    await this.eligibility.require(manager, customerId);
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
      if (row.owner_class !== row.current_class || row.owner_class === 'REVIEW')
        throw new ConflictException('Wallet ownership requires review');
      if (row.owner_class === 'CUSTOMER')
        await this.eligibility.require(manager, row.customer_id.toLowerCase());
      else if (row.owner_class !== 'AGENT')
        throw new ConflictException('Wallet ownership requires review');
    }
  }
}
