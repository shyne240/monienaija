import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { Bank } from './bank.entity';
import { BankStatus } from './bank.enums';
import type { BankView, CreateBankCommand, UpdateBankCommand } from './bank.types';

@Injectable()
export class BankService {
  constructor(@InjectRepository(Bank) private readonly bankRepository: Repository<Bank>) {}

  async create(command: CreateBankCommand): Promise<BankView> {
    const normalized = this.normalizeCreate(command);
    try {
      return this.toView(
        await this.bankRepository.save(
          this.bankRepository.create({ id: randomUUID(), ...normalized }),
        ),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('A bank with this code already exists');
      }
      throw error;
    }
  }

  async get(id: string): Promise<BankView> {
    this.assertUuid(id);
    const bank = await this.bankRepository.findOne({ where: { id } });
    if (!bank) {
      throw new NotFoundException(`Bank ${id} was not found`);
    }
    return this.toView(bank);
  }

  async list(search?: string, status?: BankStatus): Promise<BankView[]> {
    const normalizedSearch = search?.trim();
    if (!normalizedSearch && !status) {
      return (await this.bankRepository.find({ order: { bankName: 'ASC', id: 'ASC' } })).map(
        (bank) => this.toView(bank),
      );
    }

    const query = this.bankRepository.createQueryBuilder('bank');
    if (status) {
      query.andWhere('bank.status = :status', { status });
    }
    if (normalizedSearch) {
      query.andWhere(
        '(bank.bank_code ILIKE :search OR bank.bank_name ILIKE :search OR bank.short_name ILIKE :search)',
        { search: `%${normalizedSearch}%` },
      );
    }
    const banks = await query
      .orderBy('bank.bank_name', 'ASC')
      .addOrderBy('bank.id', 'ASC')
      .getMany();
    return banks.map((bank) => this.toView(bank));
  }

  async update(id: string, command: UpdateBankCommand): Promise<BankView> {
    this.assertUuid(id);
    const bank = await this.bankRepository.findOne({ where: { id } });
    if (!bank) {
      throw new NotFoundException(`Bank ${id} was not found`);
    }
    if (command.bankName !== undefined) {
      bank.bankName = this.normalizeName(command.bankName, 'bankName', 160);
    }
    if (command.shortName !== undefined) {
      bank.shortName = this.normalizeName(command.shortName, 'shortName', 80);
    }
    if (command.nipSupported !== undefined) {
      bank.nipSupported = command.nipSupported;
    }
    if (command.status !== undefined) {
      bank.status = command.status;
    }
    return this.toView(await this.bankRepository.save(bank));
  }

  async remove(id: string): Promise<void> {
    this.assertUuid(id);
    const bank = await this.bankRepository.findOne({ where: { id } });
    if (!bank) {
      throw new NotFoundException(`Bank ${id} was not found`);
    }
    await this.bankRepository.remove(bank);
  }

  private normalizeCreate(command: CreateBankCommand): CreateBankCommand {
    const bankCode = command.bankCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(bankCode)) {
      throw new BadRequestException('bankCode is invalid');
    }
    return {
      bankCode,
      bankName: this.normalizeName(command.bankName, 'bankName', 160),
      shortName: this.normalizeName(command.shortName, 'shortName', 80),
      nipSupported: command.nipSupported,
      status: command.status,
    };
  }

  private normalizeName(value: string, fieldName: string, max: number): string {
    const normalized = value.trim();
    if (normalized.length < 2 || normalized.length > max) {
      throw new BadRequestException(`${fieldName} must contain 2 to ${max} characters`);
    }
    return normalized;
  }

  private assertUuid(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('bankId must be a UUID');
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }

  private toView(bank: Bank): BankView {
    return {
      id: bank.id,
      bankCode: bank.bankCode,
      bankName: bank.bankName,
      shortName: bank.shortName,
      nipSupported: bank.nipSupported,
      status: bank.status,
      createdAt: bank.createdAt,
      updatedAt: bank.updatedAt,
    };
  }
}
