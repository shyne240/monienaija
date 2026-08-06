import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { normalizeCurrency } from '../common/money';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccount } from './wallet-account.entity';
import { WalletStatus } from './wallet.enums';
import type { CreateWalletCommand, WalletBalanceView, WalletView } from './wallet.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(WalletAccount)
    private readonly walletRepository: Repository<WalletAccount>,
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
  ) {}

  async createWallet(command: CreateWalletCommand): Promise<WalletView> {
    const customerId = command.customerId.trim();
    const currency = normalizeCurrency(command.currency);
    const idempotencyKey = command.idempotencyKey?.trim();

    if (customerId.length < 1 || customerId.length > 160) {
      throw new BadRequestException('customerId must contain between 1 and 160 characters');
    }
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'idempotencyKey is required and must be at most 255 characters',
      );
    }

    let walletId: string;
    try {
      walletId = await this.dataSource.transaction(async (manager) => {
        const wallet = await this.createWalletInTransaction(manager, {
          customerId,
          currency,
          idempotencyKey,
        });
        return wallet.id;
      });
    } catch (error) {
      if (this.isConstraintViolation(error, 'uq_wallet_accounts_creation_idempotency_key')) {
        const existing = await this.walletRepository.findOne({
          where: { creationIdempotencyKey: idempotencyKey },
        });
        if (existing) {
          this.assertSameCreationRequest(existing, customerId, currency);
          walletId = existing.id;
        } else {
          throw error;
        }
      } else if (this.isConstraintViolation(error, 'uq_wallet_accounts_customer_currency')) {
        throw new ConflictException('A wallet already exists for this customer and currency');
      } else {
        throw error;
      }
    }

    return this.getWallet(walletId);
  }

  async createWalletInTransaction(
    manager: EntityManager,
    command: CreateWalletCommand,
  ): Promise<WalletAccount> {
    const customerId = command.customerId.trim();
    const currency = normalizeCurrency(command.currency);
    const idempotencyKey = command.idempotencyKey?.trim();

    if (customerId.length < 1 || customerId.length > 160) {
      throw new BadRequestException('customerId must contain between 1 and 160 characters');
    }
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'idempotencyKey is required and must be at most 255 characters',
      );
    }

    const repository = manager.getRepository(WalletAccount);
    const existingByKey = await repository.findOne({
      where: { creationIdempotencyKey: idempotencyKey },
    });
    if (existingByKey) {
      this.assertSameCreationRequest(existingByKey, customerId, currency);
      return existingByKey;
    }

    const existingWallet = await repository.findOne({ where: { customerId, currency } });
    if (existingWallet) {
      throw new ConflictException('A wallet already exists for this customer and currency');
    }

    const id = randomUUID();
    const ledgerAccountRepository = manager.getRepository(LedgerAccount);
    const ledgerAccount = await ledgerAccountRepository.save(
      ledgerAccountRepository.create({
        id: randomUUID(),
        code: `WALLET-${id}`,
        name: `Customer wallet ${id}`,
        accountType: LedgerAccountType.LIABILITY,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency,
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: false,
        isActive: true,
      }),
    );
    return repository.save(
      repository.create({
        id,
        customerId,
        currency,
        status: WalletStatus.ACTIVE,
        ledgerAccountId: ledgerAccount.id,
        creationIdempotencyKey: idempotencyKey,
      }),
    );
  }

  async getWallet(walletId: string): Promise<WalletView> {
    this.assertUuid(walletId, 'walletId');
    const wallet = await this.walletRepository.findOne({ where: { id: walletId } });
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} was not found`);
    }

    const balance = await this.ledgerService.getAccountBalance(wallet.ledgerAccountId);
    return this.toView(wallet, balance.balanceMinor);
  }

  async getWalletBalance(walletId: string): Promise<WalletBalanceView> {
    this.assertUuid(walletId, 'walletId');
    const wallet = await this.walletRepository.findOne({ where: { id: walletId } });
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} was not found`);
    }

    const balance = await this.ledgerService.getAccountBalance(wallet.ledgerAccountId);
    return {
      walletId: wallet.id,
      currency: wallet.currency,
      balanceMinor: balance.balanceMinor,
    };
  }

  async listWallets(customerId?: string): Promise<WalletView[]> {
    const normalizedCustomerId = customerId?.trim();
    if (
      normalizedCustomerId !== undefined &&
      (normalizedCustomerId.length < 1 || normalizedCustomerId.length > 160)
    ) {
      throw new BadRequestException('customerId must contain between 1 and 160 characters');
    }

    const wallets = await this.walletRepository.find({
      where: normalizedCustomerId ? { customerId: normalizedCustomerId } : undefined,
      order: { currency: 'ASC' },
    });
    const balances = await this.ledgerService.getAccountBalances(
      wallets.map((wallet) => wallet.ledgerAccountId),
    );

    return wallets.map((wallet) =>
      this.toView(wallet, balances.get(wallet.ledgerAccountId)?.balanceMinor ?? '0'),
    );
  }

  private assertSameCreationRequest(
    wallet: WalletAccount,
    customerId: string,
    currency: string,
  ): void {
    if (wallet.customerId !== customerId || wallet.currency !== currency) {
      throw new ConflictException('The idempotency key was already used for another wallet');
    }
  }

  private assertUuid(value: string, fieldName: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${fieldName} must be a UUID`);
    }
  }

  private toView(wallet: WalletAccount, balanceMinor: string): WalletView {
    return {
      id: wallet.id,
      customerId: wallet.customerId,
      currency: wallet.currency,
      status: wallet.status,
      ledgerAccountId: wallet.ledgerAccountId,
      balanceMinor,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  private isConstraintViolation(error: unknown, constraintName: string): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { constraint?: string; code?: string };
    return driverError.code === '23505' && driverError.constraint === constraintName;
  }
}
