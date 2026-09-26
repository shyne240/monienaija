import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

import { Agent } from '../agent/agent.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgentAuthenticationService } from './agent-authentication.service';
import { AgentAuthenticationExecutionService } from './agent-authentication-execution.service';
import { AgentAuthenticationSessionService, DEFAULT_AGENT_SESSION_AUDIENCE } from './agent-authentication-session.service';
import { AgentPasswordHashVerificationService } from './agent-password-hash-verification.service';
import { AgentLoginDto } from './dto/agent-login.dto';
import { SetTransactionPinDto } from './dto/set-transaction-pin.dto';
import { VerifyTransactionPinDto } from './dto/verify-transaction-pin.dto';
import { AgentPasswordHashAlgorithm } from './agent-authentication.enums';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('agents')
export class AgentAuthenticationController {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    private readonly agentAuthenticationService: AgentAuthenticationService,
    private readonly executionService: AgentAuthenticationExecutionService,
    private readonly sessionService: AgentAuthenticationSessionService,
    private readonly verificationService: AgentPasswordHashVerificationService,
  ) {}

  @Post('sessions')
  @HttpCode(200)
  async login(@Body() dto: AgentLoginDto) {
    const result = await this.executionService.authenticate({
      agentId: dto.agentId,
      password: dto.password,
      actor: dto.agentId,
    });
    if (!result.authenticated) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const session = await this.sessionService.issue({
      authentication: result,
      actor: result.agentId,
      audience: DEFAULT_AGENT_SESSION_AUDIENCE,
    });
    // Return minimal safe payload — no hashes, no raw credential, no PIN
    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresAt: session.expiresAt,
      agentId: session.principal.agentId,
      sessionId: session.sessionId,
    };
  }

  @Post('login')
  @HttpCode(200)
  async loginAlias(@Body() dto: AgentLoginDto) {
    return this.login(dto);
  }

  @Post('sessions/logout')
  @HttpCode(200)
  async logout(@Req() req: AuthenticatedRequest) {
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }
    const principal = req.authorizationPrincipal;
    const actor = principal?.agentId ?? 'unknown-agent';
    await this.sessionService.revoke({ token, actor, reason: 'Agent logout' });
    return { revoked: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logoutAlias(@Req() req: AuthenticatedRequest) {
    return this.logout(req);
  }

  @Get('me')
  async getMe(@Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    const agent = await this.agentRepository.findOne({ where: { id: principal.agentId } });
    if (!agent || agent.deletedAt !== null) {
      throw new UnauthorizedException('Agent not found');
    }
    // Never return passwordHash, PIN hash, tokenHash, etc.
    return {
      id: agent.id,
      reference: agent.reference,
      status: agent.status,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }

  @Post('me/transaction-pin')
  @HttpCode(200)
  async setTransactionPin(@Req() req: AuthenticatedRequest, @Body() dto: SetTransactionPinDto) {
    const principal = this.requireAgentPrincipal(req);
    // PIN is numeric? Allow 4-6 digits but DTO already validates length; enforce numeric
    if (!/^\d{4,12}$/.test(dto.pin)) {
      throw new UnauthorizedException('Invalid PIN format');
    }
    // Hash PIN using same scheme as password: PBKDF2
    const salt = randomBytes(16);
    const iterations = 10000;
    const derived = this.pbkdf2Hash(dto.pin, salt, iterations);
    const pinHash = `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    const result = await this.agentAuthenticationService.setTransactionPin(principal.agentId!, {
      pinHash,
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: principal.agentId!,
    });
    // Never return pin or pinHash
    return {
      agentId: result.agentId,
      pinVersion: result.pinVersion,
      updatedAt: result.lastChangedAt,
    };
  }

  @Post('me/transaction-pin/verify')
  @HttpCode(200)
  async verifyTransactionPin(@Req() req: AuthenticatedRequest, @Body() dto: VerifyTransactionPinDto) {
    const principal = this.requireAgentPrincipal(req);
    if (!/^\d{4,12}$/.test(dto.pin)) {
      return { verified: false, reason: 'INVALID_FORMAT' };
    }
    const outcome = await this.agentAuthenticationService.verifyTransactionPin(
      principal.agentId!,
      { pin: dto.pin, actor: principal.agentId! },
      this.verificationService,
    );
    // Never return hash
    if (outcome.verified) {
      return { verified: true };
    }
    return { verified: false, reason: outcome.failureReason ?? 'MISMATCH', locked: outcome.locked ?? false };
  }

  private requireAgentPrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId) {
      throw new UnauthorizedException('Agent authentication required');
    }
    return principal;
  }

  private extractToken(req: AuthenticatedRequest): string | undefined {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return undefined;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match?.[1];
  }

  private pbkdf2Hash(pin: string, salt: Buffer, iterations: number): Buffer {
    return pbkdf2Sync(pin, salt, iterations, 32, 'sha256');
  }
}
