import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { BankingWebhookAttribution } from './banking-webhook.service';

/**
 * Webhook attribution: which institution does an inbound payment belong to?
 *
 * Resolved from the receiving account only. The payload is attacker-controllable up to the point the
 * signature is verified, and even after verification it is a claim about a payment, not about which
 * institution holds the account. The only trustworthy mapping is the account we issued.
 *
 * Returning null is a real outcome, not an error: a payment to an account we do not issue is somebody
 * else's money, and it must be reported as unresolved rather than assigned to whichever institution
 * happens to be asking.
 */
@Injectable()
export class PostgresWebhookAttribution {
  constructor(private readonly db: DataSource) {}

  async resolve(input: {
    providerKey: string;
    receivingAccountNumber: string | null;
    receivingBankCode: string | null;
    providerTransactionReference: string;
  }): Promise<BankingWebhookAttribution | null> {
    if (!input.receivingAccountNumber) return null;
    const rows = await this.db.query<Array<{ institution_id: string | null }>>(
      `SELECT w.institution_id
         FROM virtual_accounts va
         JOIN wallet_accounts w ON w.id = va.wallet_id
        WHERE va.provider=$1 AND va.account_number=$2
        LIMIT 1`,
      [input.providerKey, input.receivingAccountNumber],
    );
    const institution = rows[0]?.institution_id;
    return institution ? { institutionId: institution } : null;
  }
}
