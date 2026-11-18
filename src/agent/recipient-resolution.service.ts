import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { Agent } from './agent.entity';
import { AgentStatus } from './agent.enums';
import { AgentReceivingNumber, AgentReceivingNumberStatus } from './agent-receiving-number.entity';
import { AgentReceivingNumberService } from './agent-receiving-number.service';
import type { RecipientResolution } from './agent-receiving-number.types';

/** One authoritative namespace resolver, usable inside financial transactions. */
export async function resolveRecipientIdentityWithManager(
  manager: EntityManager,
  identifier: string,
): Promise<{
  ownerType: 'CUSTOMER' | 'AGENT';
  ownerId: string;
  receivingNumber: string;
  status: string;
  agent: Agent | null;
}> {
  const canonical = AgentReceivingNumberService.canonicalizeTo10(identifier);
  if (!canonical)
    throw new BadRequestException('identifier must be a valid Nigerian 10-digit number');
  const arn = await manager
    .getRepository(AgentReceivingNumber)
    .findOne({ where: { receivingNumber: canonical, status: AgentReceivingNumberStatus.ACTIVE } });
  const agentRepo = manager.getRepository(Agent);
  let agent: Agent | null = null;
  if (arn && arn.deletedAt === null) {
    const candidate = await agentRepo.findOne({ where: { id: arn.agentId } });
    if (
      candidate &&
      candidate.deletedAt === null &&
      (candidate.status === AgentStatus.ACTIVE || candidate.status === AgentStatus.SUSPENDED)
    )
      agent = candidate;
  }
  const phoneAgents: Array<{ id: string; status: string }> = await manager.query(
    `SELECT a.id, a.status FROM agent_verified_phone_contacts p JOIN agents a ON a.id=p.agent_id
     WHERE p.canonical_phone=$1 AND p.revoked_at IS NULL AND a.deleted_at IS NULL
       AND a.status IN ('ACTIVE','SUSPENDED') LIMIT 2`,
    [canonical],
  );
  if (phoneAgents.length > 1 || (agent && phoneAgents[0] && agent.id !== phoneAgents[0].id))
    throw new ConflictException('Recipient identifier is ambiguous');
  if (!agent && phoneAgents[0])
    agent = await agentRepo.findOne({ where: { id: phoneAgents[0].id } });
  const customers: Array<{ id: string; status: string }> = await manager.query(
    `SELECT DISTINCT c.id, c.status FROM customer_contact_methods m
     JOIN customers c ON c.id = m.customer_id
     WHERE m.type = 'PHONE' AND m.deleted_at IS NULL
       AND c.deleted_at IS NULL AND c.status IN ('ACTIVE', 'SUSPENDED')
       AND (m.normalized_value = $1 OR m.normalized_value = '+234' || $1
         OR m.normalized_value = '234' || $1 OR m.normalized_value = '0' || $1)
     LIMIT 2`,
    [canonical],
  );
  if (customers.length > 1 || (agent && customers.length > 0))
    throw new ConflictException('Recipient identifier is ambiguous');
  if (agent)
    return {
      ownerType: 'AGENT',
      ownerId: agent.id,
      receivingNumber: canonical,
      status: agent.status,
      agent,
    };
  if (customers[0])
    return {
      ownerType: 'CUSTOMER',
      ownerId: customers[0].id,
      receivingNumber: canonical,
      status: customers[0].status,
      agent: null,
    };
  throw new NotFoundException(`Recipient ${canonical} not found`);
}

@Injectable()
export class RecipientResolutionService {
  constructor(private readonly dataSource: DataSource) {}

  /** Unambiguous identity resolution shared with the quote transaction. */
  async resolve(identifier: string): Promise<RecipientResolution> {
    const identity = await resolveRecipientIdentityWithManager(this.dataSource.manager, identifier);
    return {
      ownerType: identity.ownerType,
      ownerId: identity.ownerId,
      receivingNumber: identity.receivingNumber,
      status: identity.status,
      display: identity.agent
        ? await this.agentDisplay(identity.agent)
        : await this.customerDisplay(identity.ownerId),
    };
  }

  /** Resolve a registered identifier to its unique active wallet, never by client owner claims.
   * A quote subsequently re-locks and validates wallet, eligibility and institution. */
  async resolveForWalletTransfer(identifier: string, currency: string) {
    const normalizedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(normalizedCurrency))
      throw new BadRequestException('currency is required');
    const recipient = await this.resolve(identifier);
    if (recipient.status !== 'ACTIVE') throw new ConflictException('Recipient is not active');
    const wallets = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM wallet_accounts WHERE lower(customer_id)=lower($1) AND owner_class=$2
         AND wallet_owner_class(customer_id)=owner_class AND currency=$3 AND status='ACTIVE' ORDER BY id LIMIT 2`,
      [recipient.ownerId, recipient.ownerType, normalizedCurrency],
    );
    if (wallets.length !== 1)
      throw new ConflictException('Recipient wallet is unavailable or ambiguous');
    return { ...recipient, walletId: wallets[0]!.id, currency: normalizedCurrency };
  }

  private async agentDisplay(agent: Agent): Promise<string> {
    // Try to get business_name from origin application payload or reference
    // For minimal, return agent reference; if we can find application with businessName, use that
    try {
      if (agent.originApplicationId) {
        const appRows: Array<{ business_name: string | null }> = await this.dataSource.query(
          `SELECT business_name FROM agent_applications WHERE id = $1 LIMIT 1`,
          [agent.originApplicationId],
        );
        const first = appRows[0];
        if (appRows.length > 0 && first && first.business_name) return first.business_name;
      }
    } catch {
      // ignore
    }
    return agent.reference;
  }

  private async customerDisplay(customerId: string): Promise<string> {
    try {
      const profileRows: Array<{
        display_name: string;
        deleted_at: string | null;
        is_active: boolean;
      }> = await this.dataSource.query(
        `SELECT display_name, deleted_at, is_active FROM customer_profiles WHERE customer_id = $1 ORDER BY is_active DESC, created_at ASC LIMIT 1`,
        [customerId],
      );
      const p = profileRows[0];
      if (profileRows.length > 0 && p) {
        if (p.deleted_at === null && p.display_name) return p.display_name;
        if (p.display_name) return p.display_name;
      }
    } catch {
      // ignore
    }
    try {
      const custRows: Array<{ reference: string }> = await this.dataSource.query(
        `SELECT reference FROM customers WHERE id = $1 LIMIT 1`,
        [customerId],
      );
      const first = custRows[0];
      if (custRows.length > 0 && first) return first.reference;
    } catch {
      // ignore
    }
    return customerId;
  }
}
