import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Aggregator } from '../aggregator/aggregator.entity';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/aggregators')
export class AdminAggregatorController {
  constructor(@InjectRepository(Aggregator) private readonly repo: Repository<Aggregator>) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    this.requireWorkforce(req);
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const rawLimit = Number.parseInt(limitRaw ?? '20', 10) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const [data, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC' } as never,
      skip,
      take: limit,
    });

    return { data, total, page, limit };
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
