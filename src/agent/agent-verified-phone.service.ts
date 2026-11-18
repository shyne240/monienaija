import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { consumePhoneVerificationToken } from '../customer-registration/phone-verification-token';
import { normalizeNigerianPhone } from '../customer-registration/phone-normalization';
import { AuditService } from '../operations/audit.service';

@Injectable()
export class AgentVerifiedPhoneService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  private identity(principal: AuthorizationPrincipal): { agentId: string; sessionId: string } {
    if (principal.type !== 'AGENT' || !principal.agentId || !principal.sessionId)
      throw new UnauthorizedException('Agent session required');
    return { agentId: principal.agentId, sessionId: principal.sessionId };
  }

  private async lockSession(
    manager: EntityManager,
    principal: AuthorizationPrincipal,
  ): Promise<string> {
    const { agentId, sessionId } = this.identity(principal);
    const agents: Array<{ id: string }> = await manager.query(
      `SELECT id FROM agents WHERE id=$1 AND status='ACTIVE' AND deleted_at IS NULL FOR UPDATE`,
      [agentId],
    );
    const sessions: Array<{ id: string }> = await manager.query(
      `SELECT s.id FROM agent_authentication_sessions s
       JOIN agent_authentication_credentials c ON c.id=s.credential_id AND c.agent_id=s.agent_id
       WHERE s.id=$1 AND s.agent_id=$2 AND s.audience='agent-api' AND s.status='ACTIVE'
       AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND c.status='ACTIVE'
       AND c.deleted_at IS NULL AND NOT c.rotation_required AND NOT c.account_locked
       AND date_trunc('milliseconds',s.issued_at)>=date_trunc('milliseconds',c.password_changed_at)
       AND (c.password_expires_at IS NULL OR c.password_expires_at>clock_timestamp()) FOR SHARE OF s,c`,
      [sessionId, agentId],
    );
    if (!agents.length || !sessions.length)
      throw new UnauthorizedException('Agent session unavailable');
    return agentId;
  }

  async get(principal: AuthorizationPrincipal) {
    const { agentId } = this.identity(principal);
    const rows: Array<{ canonical_phone: string; verified_at: Date; sms_enabled: boolean | null }> =
      await this.dataSource.query(
        `SELECT p.canonical_phone,p.verified_at,n.sms_enabled FROM agents a
       LEFT JOIN agent_verified_phone_contacts p ON p.agent_id=a.id AND p.revoked_at IS NULL
       LEFT JOIN agent_notification_preferences n ON n.agent_id=a.id
       WHERE a.id=$1 AND a.status='ACTIVE' AND a.deleted_at IS NULL`,
        [agentId],
      );
    if (!rows.length) throw new UnauthorizedException('Agent unavailable');
    return {
      registeredPhone: rows[0]!.canonical_phone ?? null,
      verifiedAt: rows[0]!.verified_at ?? null,
      smsEnabled: rows[0]!.sms_enabled === true,
    };
  }

  async verify(principal: AuthorizationPrincipal, phoneRaw: string, token: string) {
    if (
      typeof phoneRaw !== 'string' ||
      typeof token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    )
      throw new BadRequestException('Phone verification token is invalid or expired');
    const phone = normalizeNigerianPhone(phoneRaw);
    try {
      await this.dataSource.transaction(async (manager) => {
        const agentId = await this.lockSession(manager, principal);
        // Serialization across competing agent claims. Other contact writers may not share this
        // lock; every resolution and delivery must independently refuse cross-namespace collisions.
        await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `agent-verified-phone:${phone.canonical}`,
        ]);
        const collisions: Array<{ collision: boolean }> = await manager.query(
          `SELECT EXISTS(SELECT 1 FROM customer_contact_methods m JOIN customers c ON c.id=m.customer_id
               WHERE m.type='PHONE' AND m.deleted_at IS NULL AND c.deleted_at IS NULL
                 AND m.normalized_value=ANY($2::text[]))
            OR EXISTS(SELECT 1 FROM agent_receiving_numbers n JOIN agents a ON a.id=n.agent_id
               WHERE n.receiving_number=$1 AND n.status='ACTIVE' AND n.deleted_at IS NULL
                 AND a.deleted_at IS NULL AND n.agent_id<>$3)
            OR EXISTS(SELECT 1 FROM agent_verified_phone_contacts p
               WHERE p.canonical_phone=$1 AND p.revoked_at IS NULL AND p.agent_id<>$3) AS collision`,
          [
            phone.canonical,
            [phone.canonical, `0${phone.canonical}`, `234${phone.canonical}`, phone.e164],
            agentId,
          ],
        );
        if (collisions[0]?.collision) throw new ConflictException('Phone cannot be registered');
        const proof = await consumePhoneVerificationToken(manager, phone.canonical, token);
        await manager.query(
          `UPDATE agent_verified_phone_contacts SET revoked_at=clock_timestamp() WHERE agent_id=$1 AND revoked_at IS NULL`,
          [agentId],
        );
        const inserted: Array<{ id: string }> = await manager.query(
          `INSERT INTO agent_verified_phone_contacts(agent_id,canonical_phone,verified_at,proof_challenge_id)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [agentId, phone.canonical, proof.verifiedAt, proof.challengeId],
        );
        await this.audit.record(manager, {
          entityType: 'AGENT_VERIFIED_PHONE',
          entityId: inserted[0]!.id,
          action: 'VERIFIED',
          actor: agentId,
          newValues: {
            agentId,
            phoneSuffix: phone.canonical.slice(-4),
            proofChallengeId: proof.challengeId,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        throw new ConflictException('Phone cannot be registered');
      throw error;
    }
    return this.get(principal);
  }

  async setSmsPreference(principal: AuthorizationPrincipal, enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('smsEnabled must be a boolean');
    await this.dataSource.transaction(async (manager) => {
      const agentId = await this.lockSession(manager, principal);
      await manager.query(
        `INSERT INTO agent_notification_preferences(agent_id,sms_enabled) VALUES ($1,$2)
        ON CONFLICT (agent_id) DO UPDATE SET sms_enabled=EXCLUDED.sms_enabled, updated_at=clock_timestamp()`,
        [agentId, enabled],
      );
      await this.audit.record(manager, {
        entityType: 'AGENT_NOTIFICATION_PREFERENCE',
        entityId: agentId,
        action: 'SMS_UPDATED',
        actor: agentId,
        newValues: { smsEnabled: enabled },
      });
    });
    return this.get(principal);
  }
}
