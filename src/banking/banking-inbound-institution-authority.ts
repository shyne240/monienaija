import { Logger, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { InboundInstitutionAuthority } from '../virtual-account/inbound-institution-authority';

/**
 * Answers which institution owns a verified inbound payment, and whether it may receive it.
 *
 * This is a *resolution* authority, not a discretion: it reads the account the provider confirmed the
 * money arrived in and resolves its owning institution from our own records. It deliberately cannot
 * infer affiliation from the provider, the aggregator, the virtual-account reference or the amount —
 * those are exactly the claims an attacker controls.
 *
 * Two rules that keep it from being permissive:
 *
 * - the receiving account must resolve to exactly one institution-owned wallet. Zero or several is a
 *   refusal, because a payment credited on an ambiguous affiliation is credited to the wrong ledger;
 * - the wallet must be `ACTIVE` and institution-attributed, and a virtual account, if one is named,
 *   must be the same account the payment arrived in. A mismatch is a refusal, not a preference.
 *
 * `UNAVAILABLE` is reserved for "this deployment cannot resolve institution affiliation at all" — it is
 * not used for a payment that simply does not belong to us. That distinction matters: `UNAVAILABLE`
 * makes the caller refuse and retry later, while `DENIED` records a decision.
 */
@Injectable()
export class BankingInboundInstitutionAuthority implements InboundInstitutionAuthority {
  private readonly logger = new Logger(BankingInboundInstitutionAuthority.name);

  async authorize(
    manager: EntityManager,
    input: {
      providerKey: string;
      bankCode: string;
      accountNumber: string;
      currency: string;
      amountMinor: string;
      providerReferenceHash: string;
      virtualAccountId: string | null;
      walletAccountId: string | null;
    },
  ): Promise<'AUTHORIZED' | 'DENIED' | 'UNAVAILABLE'> {
    const rows = await manager.query<
      Array<{
        wallet_id: string;
        institution_id: string | null;
        wallet_status: string;
        owner_class: string;
        currency: string;
      }>
    >(
      `SELECT va.wallet_id,
              w.institution_id,
              w.status AS wallet_status,
              w.owner_class,
              w.currency
         FROM virtual_accounts va
         JOIN wallet_accounts w ON w.id = va.wallet_id
        WHERE va.provider=$1 AND va.account_number=$2 AND va.status='ACTIVE'`,
      [input.providerKey, input.accountNumber],
    );

    if (rows.length === 0) {
      // The account the provider says received the money is not one we issued. Somebody else's
      // payment; crediting it would move funds between institutions.
      this.logger.warn(
        `Inbound payment into an account this platform does not issue (ref hash ${input.providerReferenceHash.slice(0, 12)}…)`,
      );
      return 'DENIED';
    }
    if (rows.length > 1) {
      // More than one wallet claims this account number. Crediting either would be a guess.
      this.logger.error(
        `Inbound payment resolves to ${rows.length} wallets; refusing to choose (ref hash ${input.providerReferenceHash.slice(0, 12)}…)`,
      );
      return 'DENIED';
    }
    const row = rows[0]!;

    // The payment must be denominated in the account's currency. A cross-currency credit is a
    // conversion, and no approved conversion policy exists here.
    if (row.currency !== input.currency) return 'DENIED';

    // When the caller names the VA or wallet it expects, the resolved record must be the same one.
    if (input.virtualAccountId && input.virtualAccountId !== row.wallet_id) {
      // Named VA does not match the receiving account: the caller's own attribution is wrong.
      return 'DENIED';
    }
    if (input.walletAccountId && input.walletAccountId !== row.wallet_id) {
      return 'DENIED';
    }

    if (row.wallet_status !== 'ACTIVE') return 'DENIED';
    if (!row.institution_id) {
      // No institution attribution means there is no approved receiving institution; the caller
      // cannot post to an unattributed ledger.
      return 'DENIED';
    }
    // Only a customer-owned wallet may be credited by an inbound deposit. An agent or unclassified
    // wallet has different funding semantics and must not be credited here.
    if (row.owner_class !== 'CUSTOMER') return 'DENIED';

    return 'AUTHORIZED';
  }
}
