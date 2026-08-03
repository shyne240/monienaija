import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { Beneficiary } from './beneficiary.entity';
import { BeneficiaryType } from './beneficiary.enums';
import type {
  BeneficiaryView,
  CreateBeneficiaryCommand,
  UpdateBeneficiaryCommand,
} from './beneficiary.types';

@Injectable()
export class BeneficiaryService {
  constructor(
    @InjectRepository(Beneficiary)
    private readonly beneficiaryRepository: Repository<Beneficiary>,
  ) {}

  async create(command: CreateBeneficiaryCommand): Promise<BeneficiaryView> {
    const normalized = this.normalizeCreate(command);
    try {
      const beneficiary = await this.beneficiaryRepository.save(
        this.beneficiaryRepository.create({ id: randomUUID(), ...normalized }),
      );
      return this.toView(beneficiary);
    } catch (error) {
      if (this.isUniqueViolation(error, 'uq_beneficiaries_duplicate')) {
        throw new ConflictException('This beneficiary already exists for the customer');
      }
      throw error;
    }
  }

  async get(id: string): Promise<BeneficiaryView> {
    this.assertUuid(id);
    const beneficiary = await this.beneficiaryRepository.findOne({ where: { id } });
    if (!beneficiary) {
      throw new NotFoundException(`Beneficiary ${id} was not found`);
    }
    return this.toView(beneficiary);
  }

  async list(customerId: string): Promise<BeneficiaryView[]> {
    const normalizedCustomerId = customerId.trim();
    if (!normalizedCustomerId || normalizedCustomerId.length > 160) {
      throw new BadRequestException('customerId must contain 1 to 160 characters');
    }
    const beneficiaries = await this.beneficiaryRepository.find({
      where: { customerId: normalizedCustomerId },
      order: { nickname: 'ASC', id: 'ASC' },
    });
    return beneficiaries.map((beneficiary) => this.toView(beneficiary));
  }

  async updateNickname(id: string, command: UpdateBeneficiaryCommand): Promise<BeneficiaryView> {
    this.assertUuid(id);
    const beneficiary = await this.beneficiaryRepository.findOne({ where: { id } });
    if (!beneficiary) {
      throw new NotFoundException(`Beneficiary ${id} was not found`);
    }
    const nickname = command.nickname.trim();
    if (!nickname || nickname.length > 100) {
      throw new BadRequestException('nickname must contain 1 to 100 characters');
    }
    beneficiary.nickname = nickname;
    return this.toView(await this.beneficiaryRepository.save(beneficiary));
  }

  async remove(id: string): Promise<void> {
    this.assertUuid(id);
    const beneficiary = await this.beneficiaryRepository.findOne({ where: { id } });
    if (!beneficiary) {
      throw new NotFoundException(`Beneficiary ${id} was not found`);
    }
    await this.beneficiaryRepository.remove(beneficiary);
  }

  private normalizeCreate(command: CreateBeneficiaryCommand): CreateBeneficiaryCommand {
    const customerId = command.customerId.trim();
    const nickname = command.nickname.trim();
    const bankCode = command.bankCode.trim().toUpperCase();
    const accountNumber = command.accountNumber.trim();
    const accountName = command.accountName.trim();
    if (!customerId || customerId.length > 160) {
      throw new BadRequestException('customerId must contain 1 to 160 characters');
    }
    if (!nickname || nickname.length > 100) {
      throw new BadRequestException('nickname must contain 1 to 100 characters');
    }
    if (!/^[A-Z0-9]{3,20}$/.test(bankCode)) {
      throw new BadRequestException('bankCode is invalid');
    }
    if (!/^\d{4,32}$/.test(accountNumber)) {
      throw new BadRequestException('accountNumber must contain 4 to 32 digits');
    }
    if (accountName.length < 2 || accountName.length > 160) {
      throw new BadRequestException('accountName must contain 2 to 160 characters');
    }
    if (command.type !== BeneficiaryType.BANK_ACCOUNT) {
      throw new BadRequestException('Unsupported beneficiary type');
    }
    return { customerId, nickname, bankCode, accountNumber, accountName, type: command.type };
  }

  private assertUuid(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('beneficiaryId must be a UUID');
    }
  }

  private isUniqueViolation(error: unknown, constraint: string): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string; constraint?: string };
    return driverError.code === '23505' && driverError.constraint === constraint;
  }

  private toView(beneficiary: Beneficiary): BeneficiaryView {
    return {
      id: beneficiary.id,
      customerId: beneficiary.customerId,
      nickname: beneficiary.nickname,
      bankCode: beneficiary.bankCode,
      accountNumber: beneficiary.accountNumber,
      accountName: beneficiary.accountName,
      type: beneficiary.type,
      createdAt: beneficiary.createdAt,
      updatedAt: beneficiary.updatedAt,
    };
  }
}
