import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { RotateInitialCredentialDto } from './dto/rotate-initial-credential.dto';
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
    // V1-AGENT-CREDENTIALS-01 — workforce-issued temporary credentials must be rotated
    // before any session exists. Verification succeeded, but NO session is issued.
    if (result.rotationRequired === true) {
      return {
        rotationRequired: true,
        agentId: result.agentId,
      };
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

  @Post('credentials/rotate')
  @HttpCode(200)
  async rotateInitialCredential(@Body() dto: RotateInitialCredentialDto) {
    // Unauthenticated rotate surface (registry: AGENT_LOGIN mode — the Agent holds no session
    // yet). Step 1: prove the current (temporary) password through the REAL authentication
    // execution path (lockout/failed-attempt accounting intact).
    const auth = await this.executionService.authenticate({
      agentId: dto.agentId,
      password: dto.currentPassword,
      actor: dto.agentId,
    });
    if (!auth.authenticated || !auth.credentialId) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (auth.rotationRequired !== true) {
      // Rotation is only for workforce-issued temporary credentials; normal credentials
      // are not rotated through this surface (no second password-management path invented).
      throw new ForbiddenException('Credential rotation is not pending');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('newPassword must differ from currentPassword');
    }
    // Hash server-side with the module's established PBKDF2 convention (same as PIN setter).
    const salt = randomBytes(16);
    const iterations = 10000;
    const derived = this.pbkdf2Hash(dto.newPassword, salt, iterations);
    const newHash = `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    const credential = await this.agentAuthenticationService.rotateInitialPassword(
      dto.agentId,
      auth.credentialId,
      {
        passwordHash: newHash,
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        actor: dto.agentId,
      },
    );
    // Established rotation/revocation convention: all sessions of the rotated credential die.
    await this.sessionService.revokeAllForCredential(
      credential.id,
      dto.agentId,
      'Credential rotated after first login',
    );
    // Post-rotation, issue the Agent's first real session (login completes here).
    const session = await this.sessionService.issue({
      authentication: {
        authenticated: true,
        agentId: dto.agentId,
        credentialId: credential.id,
        passwordVersion: credential.passwordVersion,
      },
      actor: dto.agentId,
      audience: DEFAULT_AGENT_SESSION_AUDIENCE,
    });
    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresAt: session.expiresAt,
      agentId: session.principal.agentId,
      sessionId: session.sessionId,
    };
  }

  @Get('me/transaction-pin')
  async getTransactionPinStatus(@Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    const pin = await this.agentAuthenticationService.getTransactionPin(principal.agentId!);
    if (!pin) {
      return {
        status: 'NOT_SET' as const,
        exists: false,
        accountLocked: false,
      };
    }
    return {
      status: pin.accountLocked ? ('LOCKED' as const) : ('ACTIVE' as const),
      exists: true,
      accountLocked: pin.accountLocked,
      pinVersion: pin.pinVersion,
      lastChangedAt: pin.lastChangedAt,
      failedCount: pin.failedCount,
      lockedAt: pin.lockedAt,
      lockReason: pin.lockReason,
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
