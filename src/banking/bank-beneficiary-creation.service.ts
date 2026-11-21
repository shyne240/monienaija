import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { BankingDirectoryService } from './banking-directory.service';
import { BankingAccountEnquiryService } from './banking-account-enquiry.service';

/**
 * G10/G11 — bank-account beneficiary creation for customer and agent self-service.
 *
 * A principal may transfer to ANY valid external bank account — their own or another person's —
 * so this service never checks ownership of the destination account, only that it exists and is
 * resolvable. Creation is gated on a successful provider name enquiry (RESOLVED) because we
 * refuse to store an account number we cannot confirm belongs to a real bank account. When
 * the provider is unavailable the creation is refused with an honest UNAVAILABLE message
 * rather than storing an unverified destination that could be a typo.
 *
 * The stored beneficiary is immutable in its destination binding (bankCode + accountNumber +
 * accountName) once created — the migration's `guard_beneficiary_owner_binding` trigger
 * enforces that the owner fields never change.
 *
 * Both customer and agent lanes share this one service and one table; the lane is encoded in
 * which owner column is populated, exactly as migration 0802 requires.
 */
@Injectable()
export class BankBeneficiaryCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly directory: BankingDirectoryService,
    private readonly enquiry: BankingAccountEnquiryService,
  ) {}

  async createForCustomer(
    customerId: string,
    input: { bankCode: string; accountNumber: string; nickname?: string; walletId?: string },
  ): Promise<{
    id: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    nickname: string | null;
    status: string;
    verified: boolean;
  }> {
    const bankCode = this.normalizeBankCode(input.bankCode);
    const accountNumber = this.normalizeAccountNumber(input.accountNumber);
    const nickname = this.normalizeNickname(input.nickname);

    const bank = await this.directory.findOneByCode(bankCode);
    if (!bank) throw new NotFoundException('Bank not found in the authoritative directory');
    if (bank.status !== 'ACTIVE') throw new BadRequestException('The requested bank is not ACTIVE');
    if (!bank.nipSupported)
      throw new BadRequestException('The requested bank is not NIP-supported');

    // Must be a real, resolvable account — provider enquiry is the gate.
    const enquiryResult = await this.enquiry.enquireForCustomer(
      customerId,
      input.walletId,
      bankCode,
      accountNumber,
    );
    if (enquiryResult.outcome === 'NOT_FOUND')
      throw new NotFoundException('Account not found at the destination bank');
    if (enquiryResult.outcome === 'UNAVAILABLE')
      throw new BadRequestException('Account verification is temporarily unavailable. Try again.');
    if (!enquiryResult.accountName)
      throw new BadRequestException('Account name could not be resolved');

    const accountName = enquiryResult.accountName.trim();
    if (accountName.length < 2 || accountName.length > 200)
      throw new BadRequestException('Resolved account name is invalid');

    return this.persistBeneficiary({
      owner: { type: 'CUSTOMER', id: customerId },
      bankCode: bank.bankCode,
      accountNumber,
      accountName,
      nickname,
      actor: customerId,
    });
  }

  async createForAgent(
    agentId: string,
    input: { bankCode: string; accountNumber: string; nickname?: string; walletId?: string },
  ): Promise<{
    id: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    nickname: string | null;
    status: string;
    verified: boolean;
  }> {
    const bankCode = this.normalizeBankCode(input.bankCode);
    const accountNumber = this.normalizeAccountNumber(input.accountNumber);
    const nickname = this.normalizeNickname(input.nickname);

    const bank = await this.directory.findOneByCode(bankCode);
    if (!bank) throw new NotFoundException('Bank not found in the authoritative directory');
    if (bank.status !== 'ACTIVE') throw new BadRequestException('The requested bank is not ACTIVE');
    if (!bank.nipSupported)
      throw new BadRequestException('The requested bank is not NIP-supported');

    const enquiryResult = await this.enquiry.enquireForAgent(
      agentId,
      input.walletId,
      bankCode,
      accountNumber,
    );
    if (enquiryResult.outcome === 'NOT_FOUND')
      throw new NotFoundException('Account not found at the destination bank');
    if (enquiryResult.outcome === 'UNAVAILABLE')
      throw new BadRequestException('Account verification is temporarily unavailable. Try again.');
    if (!enquiryResult.accountName)
      throw new BadRequestException('Account name could not be resolved');
    const accountName = enquiryResult.accountName.trim();
    if (accountName.length < 2 || accountName.length > 200)
      throw new BadRequestException('Resolved account name is invalid');

    return this.persistBeneficiary({
      owner: { type: 'AGENT', id: agentId },
      bankCode: bank.bankCode,
      accountNumber,
      accountName,
      nickname,
      actor: agentId,
    });
  }

  private async persistBeneficiary(input: {
    owner: { type: 'CUSTOMER' | 'AGENT'; id: string };
    bankCode: string;
    accountNumber: string;
    accountName: string;
    nickname: string | null;
    actor: string;
  }): Promise<{
    id: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    nickname: string | null;
    status: string;
    verified: boolean;
  }> {
    const beneficiaryId = randomUUID();
    const reference = `bank-${randomUUID()}`;
    const normalizedDestination = input.accountNumber; // 10-digit numeric, normalized is identity
    const isCustomer = input.owner.type === 'CUSTOMER';
    const customerId = isCustomer ? input.owner.id : null;
    const agentId = !isCustomer ? input.owner.id : null;

    // Transaction: verify owner exists, check destination uniqueness, insert beneficiary + ownership + audit
    const result = await this.dataSource.transaction(async (manager) => {
      if (isCustomer) {
        const customerRows: Array<{ id: string }> = await manager.query(
          `SELECT id FROM customers WHERE id=$1 LIMIT 1`,
          [input.owner.id],
        );
        if (customerRows.length === 0) throw new NotFoundException('Customer not found');
      } else {
        const agentRows: Array<{ id: string }> = await manager.query(
          `SELECT id FROM agents WHERE id=$1 AND status='ACTIVE' AND deleted_at IS NULL LIMIT 1`,
          [input.owner.id],
        );
        if (agentRows.length === 0) throw new NotFoundException('Agent not found or not active');
      }

      // Destination uniqueness per owner — prevents duplicate beneficiaries for same account.
      const existing: Array<{ id: string }> = await manager.query(
        isCustomer
          ? `SELECT id FROM customer_beneficiaries WHERE customer_id=$1 AND normalized_destination_identifier=$2 AND deleted_at IS NULL LIMIT 1`
          : `SELECT id FROM customer_beneficiaries WHERE agent_id=$1 AND normalized_destination_identifier=$2 AND deleted_at IS NULL LIMIT 1`,
        [input.owner.id, normalizedDestination],
      );
      if (existing.length > 0)
        throw new ConflictException('A beneficiary for this destination already exists');

      const existingRef: Array<{ id: string }> = await manager.query(
        `SELECT id FROM customer_beneficiaries WHERE reference=$1 LIMIT 1`,
        [reference],
      );
      if (existingRef.length > 0)
        throw new ConflictException(`Beneficiary reference ${reference} already exists`);

      // Insert beneficiary as verified ACTIVE — the account was just resolved by the provider.
      await manager.query(
        `INSERT INTO customer_beneficiaries (id, customer_id, agent_id, beneficiary_type, display_name, reference, destination_identifier, normalized_destination_identifier, destination_name, destination_institution, nickname, status, verified, version, created_at, updated_at, deleted_at)
         VALUES ($1,$2,$3,'BANK_ACCOUNT',$4,$5,$6,$7,$8,$9,$10,'ACTIVE',true,1,clock_timestamp(),clock_timestamp(),NULL)`,
        [
          beneficiaryId,
          customerId,
          agentId,
          input.accountName,
          reference,
          input.accountNumber,
          normalizedDestination,
          input.accountName,
          input.bankCode,
          input.nickname,
        ],
      );

      const ownershipId = randomUUID();
      await manager.query(
        `INSERT INTO beneficiary_ownerships (id, beneficiary_id, customer_id, agent_id, version, deleted_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,1,NULL,clock_timestamp(),clock_timestamp())`,
        [ownershipId, beneficiaryId, customerId, agentId],
      );

      await manager.query(
        `INSERT INTO audit_events (id, entity_type, entity_id, action, actor, old_values, new_values, occurred_at)
         VALUES ($1,'CUSTOMER_BENEFICIARY',$2,'CREATED',$3,NULL,$4,clock_timestamp())`,
        [
          randomUUID(),
          beneficiaryId,
          input.actor,
          JSON.stringify({
            beneficiaryType: 'BANK_ACCOUNT',
            bankCode: input.bankCode,
            accountNumber: input.accountNumber,
            accountName: input.accountName,
            nickname: input.nickname,
            ownerType: input.owner.type,
            ownerId: input.owner.id,
          }),
        ],
      );

      // Beneficiary history
      await manager.query(
        `INSERT INTO beneficiary_history (id, beneficiary_id, action, actor, previous_status, new_status, previous_verified, new_verified, metadata, created_at)
         VALUES ($1,$2,'CREATED',$3,NULL,'ACTIVE',NULL,true,$4,clock_timestamp())`,
        [
          randomUUID(),
          beneficiaryId,
          input.actor,
          JSON.stringify({ type: 'BANK_ACCOUNT', reference }),
        ],
      );

      return {
        id: beneficiaryId,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
        nickname: input.nickname,
        status: 'ACTIVE',
        verified: true,
      };
    });

    return result;
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

  private normalizeNickname(raw?: string): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string') throw new BadRequestException('nickname must be a string');
    const v = raw.trim();
    if (v.length === 0) throw new BadRequestException('nickname must not be empty');
    if (v.length > 120) throw new BadRequestException('nickname must be at most 120 characters');
    return v;
  }
}
