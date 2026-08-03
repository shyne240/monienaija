import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { normalizeCurrency } from '../common/money';
import { SettlementAccountRole } from './payment.enums';

@Injectable()
export class SettlementAccountService {
  async getAccountId(
    manager: EntityManager,
    currency: string,
    role: SettlementAccountRole,
  ): Promise<string> {
    const normalizedCurrency = normalizeCurrency(currency);
    const code = `PAYMENT-${role}-${normalizedCurrency}`;
    const result: unknown = await manager.query(
      `SELECT id::text AS id
         FROM ledger_accounts
        WHERE code = $1
          AND currency = $2
          AND accounting_unit = 'CUSTOMER_FUNDS'
          AND is_active = TRUE`,
      [code, normalizedCurrency],
    );
    const rows = isUnknownArray(result) ? result : [];
    const first = rows[0];
    const accountId =
      typeof first === 'object' && first !== null && 'id' in first ? first.id : undefined;
    if (typeof accountId !== 'string' || accountId.length === 0) {
      throw new ConflictException(
        `Settlement account ${role} is not configured for ${normalizedCurrency}`,
      );
    }

    return accountId;
  }
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
