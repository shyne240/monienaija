import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, QueryFailedError } from 'typeorm';

import { ContactMethodType } from '../customer/customer.enums';
import { isCanonicalNigerianPhone, nationalSignificantNumber } from '../customer/nigerian-phone';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { AuditService } from '../operations/audit.service';
import { CustomerReceivingNumber } from './customer-receiving-number.entity';
import {
  CustomerReceivingNumberSource,
  CustomerReceivingNumberStatus,
} from './customer-receiving-number.enums';
import { CustomerWallet } from './customer-wallet.entity';
import {
  CustomerWalletStatus,
  CustomerWalletType,
  WalletProvisioningHistoryAction,
} from './customer-wallet.enums';
import { WalletProvisioningHistory } from './wallet-provisioning-history.entity';
import {
  RECEIVING_NUMBER_ISSUE_UNIQUE_VIOLATION_NUMBERS,
  RECEIVING_NUMBER_ISSUE_UNIQUE_VIOLATION_WALLETS,
} from './customer-receiving-number.types';

const RECEIVING_NUMBER_PATTERN = /^[0-9]{10}$/;

export interface IssueReceivingNumberCommand {
  customerId: string;
  walletId: string;
  actor: string;
  /** Optional correlation id propagated by the caller (defaults to generated). */
  correlationId?: string;
}

/**
 * System-issued primary MonieNaija receiving numbers.
 *
 * A receiving number is a thin, deterministic, globally-unique receiving
 * identifier for one ACTIVE PRIMARY CustomerWallet. It is derived from the
 * NSN of the customer's canonical Nigerian phone (Phase 1 output). The
 * number is NEVER customer-selected, NEVER reassigned to a different wallet,
 * and NEVER silently replaced on collision.
 */
@Injectable()
export class CustomerReceivingNumberService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Establishes the wallet's primary receiving number inside a caller-owned
   * transaction (atomically with the wallet-activation lifecycle).
   *
   * Behaviour:
   * - wallet already has an ACTIVE number → return it unchanged (idempotent).
   * - wallet is not ACTIVE/PRIMARY, or customer has no canonical Nigerian
   *   phone contact → return null (no number issuable at this point; this is
   *   NOT an error, the wallet simply has no receiving identity yet).
   * - deterministic NSN collision with another wallet's ACTIVE number →
   *   ConflictException. Never auto-assigns a different number.
   * - concurrent issuance for the same wallet: exactly one INSERT wins;
   *   losers converge onto the winner's row.
   */
  async issueInTransaction(
    manager: EntityManager,
    command: IssueReceivingNumberCommand,
  ): Promise<CustomerReceivingNumber | null> {
    const correlationId = command.correlationId ?? randomUUID();
    const repository = manager.getRepository(CustomerReceivingNumber);
    const walletRepository = manager.getRepository(CustomerWallet);

    const existingForWallet = await repository.findOne({
      where: { walletId: command.walletId, status: CustomerReceivingNumberStatus.ACTIVE },
    });
    if (existingForWallet) {
      return existingForWallet;
    }

    const wallet = await walletRepository.findOne({ where: { id: command.walletId } });
    if (!wallet || wallet.deletedAt) {
      throw new NotFoundException(`Customer wallet ${command.walletId} was not found`);
    }
    if (wallet.customerId !== command.customerId) {
      throw new ForbiddenException('Wallet does not belong to the customer');
    }
    if (wallet.type !== CustomerWalletType.PRIMARY) {
      return null;
    }
    if (wallet.status !== CustomerWalletStatus.ACTIVE) {
      return null;
    }

    const phone = await this.primaryCanonicalPhone(manager, command.customerId);
    if (!phone) {
      return null;
    }
    const number = nationalSignificantNumber(phone.normalizedValue);
    if (!number) {
      return null;
    }

    // Pre-check for an existing ACTIVE number with the same digits. A row
    // owned by a DIFFERENT wallet is a hard collision: surfaced, never
    // silently resolved by assigning a different number.
    const existingForNumber = await repository.findOne({ where: { number } });
    if (existingForNumber) {
      if (existingForNumber.walletId === command.walletId) {
        if (existingForNumber.status === CustomerReceivingNumberStatus.ACTIVE) {
          return existingForNumber;
        }
        // Re-establishing the same wallet's own previously-issued number is
        // stable and therefore allowed; reassigning across wallets is not.
        existingForNumber.status = CustomerReceivingNumberStatus.ACTIVE;
        existingForNumber.deactivatedAt = null;
        const restored = await repository.save(existingForNumber);
        await this.auditIssuance(
          manager,
          command.actor,
          correlationId,
          restored,
          phone.normalizedValue,
        );
        await this.appendIssuanceHistory(manager, command, restored, number);
        return restored;
      }
      if (existingForNumber.status === CustomerReceivingNumberStatus.ACTIVE) {
        throw new ConflictException(
          `Receiving number ${number} is already assigned to another wallet (RECEIVING_NUMBER_COLLISION)`,
        );
      }
      throw new ConflictException(
        `Receiving number ${number} was previously issued to another wallet and cannot be reassigned (RECEIVING_NUMBER_COLLISION)`,
      );
    }

    const issued = repository.create({
      id: randomUUID(),
      customerId: command.customerId,
      walletId: command.walletId,
      number,
      source: CustomerReceivingNumberSource.PHONE_NSN,
      status: CustomerReceivingNumberStatus.ACTIVE,
      derivedFromPhone: phone.normalizedValue,
      deactivatedAt: null,
    });
    try {
      const saved = await repository.save(issued);
      await this.auditIssuance(manager, command.actor, correlationId, saved, phone.normalizedValue);
      await this.appendIssuanceHistory(manager, command, saved, number);
      return saved;
    } catch (error) {
      if (this.isUniqueViolationOn(error, RECEIVING_NUMBER_ISSUE_UNIQUE_VIOLATION_NUMBERS)) {
        throw new ConflictException(
          `Receiving number ${number} collided with a concurrent issuance (RECEIVING_NUMBER_COLLISION)`,
        );
      }
      if (this.isUniqueViolationOn(error, RECEIVING_NUMBER_ISSUE_UNIQUE_VIOLATION_WALLETS)) {
        // Concurrent issuance for the same wallet: converge on the winner.
        const winner = await repository.findOne({
          where: { walletId: command.walletId, status: CustomerReceivingNumberStatus.ACTIVE },
        });
        if (winner && winner.number === number) {
          return winner;
        }
        if (winner) {
          throw new ConflictException(
            `Concurrent issuance disagreement for wallet ${command.walletId} (RECEIVING_NUMBER_COLLISION)`,
          );
        }
      }
      throw error;
    }
  }

  /** Transaction-owning wrapper of issueInTransaction for non-lifecycle callers (e.g. phone retro-issuance). */
  async issue(command: IssueReceivingNumberCommand): Promise<CustomerReceivingNumber | null> {
    return this.dataSource.transaction((manager) => this.issueInTransaction(manager, command));
  }

  /**
   * Retro-issuance entry point: issues a number for the customer's ACTIVE
   * PRIMARY wallet when one becomes eligible (e.g. the first canonical phone
   * contact is added after the wallet was already activated). Null when no
   * ACTIVE PRIMARY wallet exists or a number is already present.
   */
  async issueForPrimaryWalletIfEligible(
    manager: EntityManager,
    customerId: string,
    actor: string,
  ): Promise<CustomerReceivingNumber | null> {
    const wallet = await manager.getRepository(CustomerWallet).findOne({
      where: {
        customerId,
        type: CustomerWalletType.PRIMARY,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
    if (!wallet || wallet.status !== CustomerWalletStatus.ACTIVE) {
      return null;
    }
    return this.issueInTransaction(manager, { customerId, walletId: wallet.id, actor });
  }

  /** The wallet's ACTIVE receiving number, or null (e.g. PENDING/unissued). */
  async findActiveByWallet(walletId: string): Promise<CustomerReceivingNumber | null> {
    return this.dataSource.getRepository(CustomerReceivingNumber).findOne({
      where: { walletId, status: CustomerReceivingNumberStatus.ACTIVE },
    });
  }

  /** The ACTIVE receiving-number record for exactly-10-digit input; null when malformed or unissued. */
  async findActiveByNumber(number: string): Promise<CustomerReceivingNumber | null> {
    if (!RECEIVING_NUMBER_PATTERN.test(number.trim())) {
      return null;
    }
    return this.dataSource.getRepository(CustomerReceivingNumber).findOne({
      where: { number: number.trim(), status: CustomerReceivingNumberStatus.ACTIVE },
    });
  }

  private async primaryCanonicalPhone(
    manager: EntityManager,
    customerId: string,
  ): Promise<CustomerContactMethod | null> {
    const rows = await manager.getRepository(CustomerContactMethod).find({
      where: { customerId, type: ContactMethodType.PHONE, deletedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const canonical = rows.filter((row) => isCanonicalNigerianPhone(row.normalizedValue));
    return canonical.find((row) => row.isPrimary) ?? canonical[0] ?? null;
  }

  private async auditIssuance(
    manager: EntityManager,
    actor: string,
    correlationId: string,
    issued: CustomerReceivingNumber,
    canonicalPhone: string,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'CUSTOMER_RECEIVING_NUMBER',
      entityId: issued.id,
      action: 'ISSUED',
      actor,
      correlationId,
      newValues: {
        customerId: issued.customerId,
        walletId: issued.walletId,
        number: issued.number,
        source: issued.source,
        status: issued.status,
        derivedFromPhone: canonicalPhone,
      },
    });
  }

  private async appendIssuanceHistory(
    manager: EntityManager,
    command: IssueReceivingNumberCommand,
    issued: CustomerReceivingNumber,
    number: string,
  ): Promise<void> {
    const history = await manager.getRepository(WalletProvisioningHistory).save(
      manager.getRepository(WalletProvisioningHistory).create({
        id: randomUUID(),
        walletId: command.walletId,
        action: WalletProvisioningHistoryAction.RECEIVING_NUMBER_ISSUED,
        previousStatus: null,
        newStatus: CustomerWalletStatus.ACTIVE,
        actor: command.actor,
        metadata: {
          receivingNumber: number,
          receivingNumberId: issued.id,
          source: issued.source,
        },
        deletedAt: null,
      }),
    );
    await this.auditService.record(manager, {
      entityType: 'WALLET_PROVISIONING_HISTORY',
      entityId: history.id,
      action: 'CREATED',
      actor: command.actor,
      newValues: {
        action: WalletProvisioningHistoryAction.RECEIVING_NUMBER_ISSUED,
        receivingNumber: number,
      },
    });
  }

  private isUniqueViolationOn(error: unknown, fragment: string): boolean {
    return (
      error instanceof QueryFailedError &&
      typeof (error as { constraint?: string }).constraint === 'string' &&
      ((error as { constraint?: string }).constraint ?? '').includes(fragment)
    );
  }
}
