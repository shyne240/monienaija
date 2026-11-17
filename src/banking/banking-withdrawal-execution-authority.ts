import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { WithdrawalExecutionAuthority } from '../financial-commitment/withdrawal-execution-authority';
import type { BankingReadinessService } from './banking-readiness.service';

/**
 * The A6 execution-authority decision, answered by governed banking configuration.
 *
 * This is the ONLY place where the accepted commitment lifecycle asks whether an outbound transfer may
 * proceed, and it is deliberately narrow: it answers a question, it does not move money. Everything
 * else about A6 — eligibility, limits, PIN binding, destination binding, reservation, ledger posting,
 * provider reference creation, replay protection — remains exactly where it was and is not
 * reimplemented here.
 *
 * The answer is `AUTHORIZED` only when a governed, approved, credentialed and operationally-ready
 * provider configuration exists for the wallet's own institution and actually declares the outbound
 * capability. Any other outcome is `DENIED` or `UNAVAILABLE`, both of which the existing service
 * already turns into a refusal. There is therefore no configuration state in which this adapter is
 * more permissive than the previous always-unavailable one — it can only ever add a path that
 * requires an explicit, independently approved decision.
 *
 * Note the deliberate omission: this authority does not read a fee, a limit or a destination. Those
 * were already bound by the commitment before this call, and re-reading them here would create a
 * second source of truth for an authorized transaction.
 */
@Injectable()
export class BankingWithdrawalExecutionAuthority implements WithdrawalExecutionAuthority {
  private readonly logger = new Logger(BankingWithdrawalExecutionAuthority.name);

  constructor(
    private readonly readiness: BankingReadinessService,
    private readonly providers: readonly string[],
    private readonly environment: 'sandbox' | 'production',
  ) {}

  async authorize(
    manager: EntityManager,
    input: {
      customerId: string;
      walletAccountId: string;
      beneficiaryId: string;
      beneficiaryVersion: number;
      bankId: string;
      bankCode: string;
      accountNumber: string;
      targetReference: string;
      amountMinor: string;
      currency: string;
    },
  ): Promise<'AUTHORIZED' | 'DENIED' | 'UNAVAILABLE'> {
    if (this.providers.length === 0) {
      // No banking provider configured at all. This is the pre-existing behaviour and must stay
      // a refusal, never an implicit authorization.
      return 'UNAVAILABLE';
    }

    // The institution comes from the wallet as locked by the caller's own transaction, so a caller
    // cannot point the check at a different institution than the wallet it is debiting.
    const wallets = await manager.query<Array<{ institution_id: string | null; status: string }>>(
      // Same authoritative-ownership predicate as the wallet layer: a CUSTOMER-classified wallet
      // whose owner reference resolves to exactly this customer. A mismatch denies, and denial here
      // means the commitment cannot proceed.
      `SELECT institution_id,status FROM wallet_accounts
        WHERE id=$1 AND customer_id=$2::text AND owner_class='CUSTOMER' FOR SHARE`,
      [input.walletAccountId, input.customerId],
    );
    const wallet = wallets[0];
    if (!wallet || wallet.status !== 'ACTIVE') return 'DENIED';
    if (!wallet.institution_id) {
      // A wallet with no institution cannot be tied to an approved provider configuration.
      return 'DENIED';
    }

    let unusable = 0;
    for (const providerKey of this.providers) {
      const check = await this.readiness.capabilityUsable(
        wallet.institution_id,
        providerKey,
        this.environment,
        'OUTBOUND_TRANSFER_SUBMIT',
      );
      if (check.usable) {
        this.logger.log(
          `Outbound execution authorized via ${providerKey} for institution ${wallet.institution_id}`,
        );
        return 'AUTHORIZED';
      }
      unusable += 1;
    }

    // Configuration exists but is not usable. UNAVAILABLE is the honest answer: the customer is not
    // being told their transfer was refused, they are being told the service cannot take it yet.
    this.logger.warn(
      `Outbound execution unavailable: ${unusable} provider(s) not usable for institution ${wallet.institution_id}`,
    );
    return 'UNAVAILABLE';
  }
}
