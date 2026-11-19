import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { BankingProviderRegistry } from './banking-provider.registry';
import { BankingReadinessService } from './banking-readiness.service';
import { BankingDirectoryService } from './banking-directory.service';
import type { AccountNameEnquiryResult } from './banking-provider.types';

/**
 * G10 — account-name enquiry for self-service.
 *
 * A customer or agent supplies a bank code + account number; we return the account name
 * when the provider confirms it, NOT_FOUND when the provider says it does not exist, and
 * UNAVAILABLE otherwise. The result never claims ownership — `establishesAccountOwnership`
 * is always false, as documented in the provider contract.
 *
 * Preconditions checked before any provider call:
 * - bank code and account number format;
 * - bank exists in the authoritative directory and is ACTIVE + NIP_SUPPORTED;
 *   otherwise 404/400 without touching a provider.
 *
 * Provider selection reuses the same institution-governed readiness that gates virtual-account
 * provisioning: the wallet's institution determines which provider is authorized for this
 * enquiry, and the provider must be registered, approved, credentialed and operational.
 * When no provider is usable the outcome is UNAVAILABLE rather than a fabricated rejection.
 */
@Injectable()
export class BankingAccountEnquiryService {
  private readonly logger = new Logger(BankingAccountEnquiryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly directory: BankingDirectoryService,
    private readonly registry: BankingProviderRegistry,
    private readonly readiness: BankingReadinessService,
  ) {}

  async enquireForCustomer(
    customerId: string,
    walletId: string | undefined,
    bankCodeRaw: string,
    accountNumberRaw: string,
  ): Promise<AccountNameEnquiryResult> {
    const bankCode = this.normalizeBankCode(bankCodeRaw);
    const accountNumber = this.normalizeAccountNumber(accountNumberRaw);
    const bank = await this.directory.findOneByCode(bankCode);
    if (!bank) throw new NotFoundException('Bank not found in the authoritative directory');
    if (bank.status !== 'ACTIVE') throw new BadRequestException('The requested bank is not ACTIVE');
    if (!bank.nipSupported)
      throw new BadRequestException('The requested bank is not NIP-supported');

    // Institution is derived from the wallet when supplied, otherwise from any ACTIVE wallet of the customer.
    // This keeps the institution check from being bypassable via an absent wallet.
    const institutionId = await this.resolveInstitutionForCustomer(customerId, walletId);
    const correlationId = randomUUID();
    if (!institutionId) {
      return {
        outcome: 'UNAVAILABLE',
        providerBankCode: bankCode,
        accountNumber,
        establishesAccountOwnership: false,
        correlationId,
      };
    }
    return this.enquireViaProvider(institutionId, bankCode, accountNumber, correlationId);
  }

  async enquireForAgent(
    agentId: string,
    walletId: string | undefined,
    bankCodeRaw: string,
    accountNumberRaw: string,
  ): Promise<AccountNameEnquiryResult> {
    const bankCode = this.normalizeBankCode(bankCodeRaw);
    const accountNumber = this.normalizeAccountNumber(accountNumberRaw);
    const bank = await this.directory.findOneByCode(bankCode);
    if (!bank) throw new NotFoundException('Bank not found in the authoritative directory');
    if (bank.status !== 'ACTIVE') throw new BadRequestException('The requested bank is not ACTIVE');
    if (!bank.nipSupported)
      throw new BadRequestException('The requested bank is not NIP-supported');

    const institutionId = await this.resolveInstitutionForAgent(agentId, walletId);
    const correlationId = randomUUID();
    if (!institutionId) {
      return {
        outcome: 'UNAVAILABLE',
        providerBankCode: bankCode,
        accountNumber,
        establishesAccountOwnership: false,
        correlationId,
      };
    }
    return this.enquireViaProvider(institutionId, bankCode, accountNumber, correlationId);
  }

  private async enquireViaProvider(
    institutionId: string,
    bankCode: string,
    accountNumber: string,
    correlationId: string,
  ): Promise<AccountNameEnquiryResult> {
    // Find a usable provider for this institution + capability. Try each registered provider
    // that advertises ACCOUNT_NAME_ENQUIRY and is usable per readiness.
    for (const provider of this.registry.list()) {
      if (!provider.descriptor.capabilities.ACCOUNT_NAME_ENQUIRY) continue;
      const usable = await this.readiness.capabilityUsable(
        institutionId,
        provider.descriptor.key,
        provider.descriptor.environment,
        'ACCOUNT_NAME_ENQUIRY',
      );
      if (!usable.usable) continue;
      const adapter = provider;
      if (!adapter.enquireAccountName) continue;
      try {
        const result = await adapter.enquireAccountName(
          { providerBankCode: bankCode, accountNumber },
          { correlationId },
        );
        if (result.ok) {
          return result.value;
        }
        // Provider rejected in a way that maps to NOT_FOUND is already normalized by the adapter.
        // Any other error (transport, auth, timeout) is UNAVAILABLE — we never treat an outage as
        // \"this account does not exist\".
        this.logger.warn(
          `Account enquiry provider error ${result.error.code}: ${result.error.detail}`,
        );
        return {
          outcome: 'UNAVAILABLE',
          providerBankCode: bankCode,
          accountNumber,
          establishesAccountOwnership: false,
          correlationId,
        };
      } catch (error) {
        this.logger.warn(`Account enquiry provider threw: ${(error as Error).message}`);
        return {
          outcome: 'UNAVAILABLE',
          providerBankCode: bankCode,
          accountNumber,
          establishesAccountOwnership: false,
          correlationId,
        };
      }
    }
    return {
      outcome: 'UNAVAILABLE',
      providerBankCode: bankCode,
      accountNumber,
      establishesAccountOwnership: false,
      correlationId,
    };
  }

  private normalizeBankCode(raw: string): string {
    if (typeof raw !== 'string' || !raw.trim())
      throw new BadRequestException('bankCode is required');
    const v = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(v)) throw new BadRequestException('bankCode is invalid');
    return v;
  }

  private normalizeAccountNumber(raw: string): string {
    if (typeof raw !== 'string' || !raw.trim())
      throw new BadRequestException('accountNumber is required');
    const v = raw.trim();
    if (!/^\d{10}$/.test(v))
      throw new BadRequestException('accountNumber must be exactly 10 digits');
    return v;
  }

  private async resolveInstitutionForCustomer(
    customerId: string,
    walletId?: string,
  ): Promise<string | null> {
    if (walletId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(walletId))
        throw new BadRequestException('walletId must be a UUID');
      const rows = await this.dataSource.query<Array<{ institution_id: string | null }>>(
        `SELECT institution_id FROM wallet_accounts WHERE id=$1 AND customer_id=$2::text AND owner_class='CUSTOMER' LIMIT 1`,
        [walletId.toLowerCase(), customerId],
      );
      if (rows[0]?.institution_id) return rows[0].institution_id;
    }
    // Fallback: any ACTIVE customer wallet with institution
    const fallback = await this.dataSource.query<Array<{ institution_id: string }>>(
      `SELECT institution_id FROM wallet_accounts WHERE customer_id=$1::text AND owner_class='CUSTOMER' AND status='ACTIVE' AND institution_id IS NOT NULL LIMIT 1`,
      [customerId],
    );
    return fallback[0]?.institution_id ?? null;
  }

  private async resolveInstitutionForAgent(
    agentId: string,
    walletId?: string,
  ): Promise<string | null> {
    if (walletId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(walletId))
        throw new BadRequestException('walletId must be a UUID');
      const rows = await this.dataSource.query<Array<{ institution_id: string | null }>>(
        `SELECT institution_id FROM wallet_accounts WHERE id=$1 AND customer_id=$2::text AND owner_class='AGENT' LIMIT 1`,
        [walletId.toLowerCase(), agentId],
      );
      if (rows[0]?.institution_id) return rows[0].institution_id;
    }
    const fallback = await this.dataSource.query<Array<{ institution_id: string }>>(
      `SELECT institution_id FROM wallet_accounts WHERE customer_id=$1::text AND owner_class='AGENT' AND status='ACTIVE' AND institution_id IS NOT NULL LIMIT 1`,
      [agentId],
    );
    return fallback[0]?.institution_id ?? null;
  }
}
