import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { assertPaymentUuid, isConstraintViolation } from '../payment/payment-support';
import { PaymentType } from '../payment/payment.enums';
import { PaymentReferenceService } from '../payment/payment-reference.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletStatus } from '../wallet/wallet.enums';
import { VirtualAccount } from './virtual-account.entity';
import { VirtualAccountStatus } from './virtual-account.enums';
import type { AssignVirtualAccountCommand, VirtualAccountView } from './virtual-account.types';

@Injectable()
export class VirtualAccountService {
  constructor(
    @InjectRepository(VirtualAccount)
    private readonly virtualAccountRepository: Repository<VirtualAccount>,
    private readonly dataSource: DataSource,
    private readonly paymentReferenceService: PaymentReferenceService,
  ) {}

  async assign(command: AssignVirtualAccountCommand): Promise<VirtualAccountView> {
    const normalized = this.normalizeCommand(command);
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const wallet = await this.lockWallet(manager, normalized.walletId);
        if (!wallet) {
          throw new NotFoundException(`Wallet ${normalized.walletId} was not found`);
        }
        if (wallet.status !== WalletStatus.ACTIVE) {
          throw new ConflictException('A virtual account can only be assigned to an active wallet');
        }

        const repository = manager.getRepository(VirtualAccount);
        const existing = await repository.findOne({
          where: {
            walletId: normalized.walletId,
            provider: normalized.provider,
            status: VirtualAccountStatus.ACTIVE,
          },
        });
        if (existing) {
          throw new ConflictException(
            `Wallet already has an active virtual account with provider ${normalized.provider}`,
          );
        }

        const id = randomUUID();
        const reference = await this.paymentReferenceService.nextReference(
          manager,
          PaymentType.VIRTUAL_ACCOUNT,
          id,
        );
        await repository.save(
          repository.create({
            id,
            walletId: normalized.walletId,
            bankCode: normalized.bankCode,
            accountNumber: normalized.accountNumber,
            accountName: normalized.accountName,
            provider: normalized.provider,
            status: VirtualAccountStatus.ACTIVE,
            reference,
            assignedAt: new Date(),
            deactivatedAt: null,
          }),
        );
        return id;
      });
      return this.get(id);
    } catch (error) {
      if (isConstraintViolation(error, 'uq_virtual_accounts_wallet_provider_active')) {
        throw new ConflictException(
          'Wallet already has an active virtual account with this provider',
        );
      }
      if (isConstraintViolation(error, 'uq_virtual_accounts_provider_number')) {
        throw new ConflictException('This provider account number is already assigned');
      }
      throw error;
    }
  }

  async get(id: string): Promise<VirtualAccountView> {
    assertPaymentUuid(id, 'virtualAccountId');
    const account = await this.virtualAccountRepository.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Virtual account ${id} was not found`);
    }
    return this.toView(account);
  }

  async list(walletId?: string): Promise<VirtualAccountView[]> {
    if (walletId !== undefined) {
      assertPaymentUuid(walletId, 'walletId');
    }
    const accounts = await this.virtualAccountRepository.find({
      where: walletId ? { walletId } : undefined,
      order: { assignedAt: 'DESC', id: 'DESC' },
    });
    return accounts.map((account) => this.toView(account));
  }

  async lookup(accountNumber: string, provider: string): Promise<VirtualAccountView> {
    const normalizedNumber = accountNumber.trim();
    const normalizedProvider = provider.trim().toUpperCase();
    if (!/^\d{4,32}$/.test(normalizedNumber)) {
      throw new BadRequestException('accountNumber must contain 4 to 32 digits');
    }
    if (!/^[A-Z0-9_.:-]{2,80}$/.test(normalizedProvider)) {
      throw new BadRequestException('provider is invalid');
    }
    const account = await this.virtualAccountRepository.findOne({
      where: { accountNumber: normalizedNumber, provider: normalizedProvider },
    });
    if (!account) {
      throw new NotFoundException('Virtual account was not found');
    }
    return this.toView(account);
  }

  async deactivate(id: string): Promise<VirtualAccountView> {
    assertPaymentUuid(id, 'virtualAccountId');
    const accountId = await this.dataSource.transaction(async (manager) => {
      const account = await this.lockVirtualAccount(manager, id);
      if (!account) {
        throw new NotFoundException(`Virtual account ${id} was not found`);
      }
      if (account.status === VirtualAccountStatus.DEACTIVATED) {
        return account.id;
      }
      account.status = VirtualAccountStatus.DEACTIVATED;
      account.deactivatedAt = new Date();
      await manager.getRepository(VirtualAccount).save(account);
      return account.id;
    });
    return this.get(accountId);
  }

  private async lockWallet(
    manager: EntityManager,
    walletId: string,
  ): Promise<WalletAccount | null> {
    return manager
      .getRepository(WalletAccount)
      .createQueryBuilder('wallet')
      .where('wallet.id = :walletId', { walletId })
      .setLock('pessimistic_write')
      .getOne();
  }

  private async lockVirtualAccount(
    manager: EntityManager,
    id: string,
  ): Promise<VirtualAccount | null> {
    return manager
      .getRepository(VirtualAccount)
      .createQueryBuilder('virtual_account')
      .where('virtual_account.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  private normalizeCommand(command: AssignVirtualAccountCommand): AssignVirtualAccountCommand {
    const walletId = command.walletId.trim().toLowerCase();
    assertPaymentUuid(walletId, 'walletId');
    const bankCode = command.bankCode.trim().toUpperCase();
    const accountNumber = command.accountNumber.trim();
    const accountName = command.accountName.trim();
    const provider = command.provider.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(bankCode)) {
      throw new BadRequestException('bankCode is invalid');
    }
    if (!/^\d{4,32}$/.test(accountNumber)) {
      throw new BadRequestException('accountNumber must contain 4 to 32 digits');
    }
    if (accountName.length < 2 || accountName.length > 160) {
      throw new BadRequestException('accountName must contain 2 to 160 characters');
    }
    if (!/^[A-Z0-9_.:-]{2,80}$/.test(provider)) {
      throw new BadRequestException('provider is invalid');
    }
    return { walletId, bankCode, accountNumber, accountName, provider };
  }

  private toView(account: VirtualAccount): VirtualAccountView {
    return {
      id: account.id,
      walletId: account.walletId,
      bankCode: account.bankCode,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      provider: account.provider,
      status: account.status,
      reference: account.reference,
      assignedAt: account.assignedAt,
      deactivatedAt: account.deactivatedAt,
    };
  }
}
