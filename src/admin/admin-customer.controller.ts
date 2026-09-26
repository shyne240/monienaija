import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/customers')
export class AdminCustomerController {
  constructor(@InjectRepository(Customer) private readonly repo: Repository<Customer>) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    this.requireWorkforce(req);
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const rawLimit = Number.parseInt(limitRaw ?? '20', 10) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (type) where['type'] = type;

    const [data, total] = await this.repo.findAndCount({
      where: Object.keys(where).length ? (where as never) : {},
      order: { createdAt: 'DESC' } as never,
      skip,
      take: limit,
    });

    return { data, total, page, limit };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    const customer = await this.repo.findOne({ where: { id } as never });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  private requireWorkforce(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (
      principal.type === 'AGENT' ||
      principal.type === 'CUSTOMER' ||
      (principal.type as string) === 'AGGREGATOR'
    ) {
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
  }
}
