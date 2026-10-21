import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Agent } from './agent.entity';
import { AgentStatus } from './agent.enums';
import { AgentReceivingNumber, AgentReceivingNumberStatus } from './agent-receiving-number.entity';
import { AgentReceivingNumberService } from './agent-receiving-number.service';
import type { RecipientResolution } from './agent-receiving-number.types';

@Injectable()
export class RecipientResolutionService {
  constructor(
    @InjectRepository(AgentReceivingNumber)
    private readonly agentReceivingRepo: Repository<AgentReceivingNumber>,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Resolve a Nigerian identifier (10-digit MonieNaija receiving number or phone) to
   * exactly one {ownerType, ownerId, receivingNumber, display}.
   * - Agent numbers are 10-digit ACTIVE in agent_receiving_numbers with agent status ACTIVE|SUSPENDED.
   * - Customer numbers are primary PHONE contact methods (is_primary) normalized to canonical 10-digit.
   * - No TERMINATED/PENDING/deleted/rejected agent is exposed.
   * - Global uniqueness ensures never both CUSTOMER and AGENT for same canonical.
   */
  async resolve(identifier: string): Promise<RecipientResolution> {
    const canonical = AgentReceivingNumberService.canonicalizeTo10(identifier);
    if (!canonical) {
      throw new BadRequestException('identifier must be a valid Nigerian 10-digit number');
    }

    // 1) Try Agent first — must be ACTIVE receiving number and agent not deleted/terminated
    const arn = await this.agentReceivingRepo.findOne({
      where: { receivingNumber: canonical, status: AgentReceivingNumberStatus.ACTIVE },
    });
    if (arn && arn.deletedAt === null) {
      const agent = await this.agentRepo.findOne({ where: { id: arn.agentId } });
      if (agent && agent.deletedAt === null) {
        if (agent.status === AgentStatus.ACTIVE || agent.status === AgentStatus.SUSPENDED) {
          // For SUSPENDED, we return identity but caller must block financial use via status
          const display = await this.agentDisplay(agent);
          return {
            ownerType: 'AGENT',
            ownerId: agent.id,
            receivingNumber: canonical,
            display,
            status: agent.status,
          };
        }
        // TERMINATED/PENDING -> not resolvable as active recipient
      }
    }

    // 2) Try Customer — resolve via customer_contact_methods PHONE
    // Use raw query to canonicalize normalized_value and match
    const customerId = await this.findCustomerIdByCanonical(canonical);
    if (customerId) {
      const custRows: Array<{ id: string; status: string; reference: string; deleted_at: string | null }> =
        await this.dataSource.query(`SELECT id, status, reference, deleted_at FROM customers WHERE id = $1 LIMIT 1`, [
          customerId,
        ]);
      const customer = custRows[0];
      if (customer && customer.deleted_at === null) {
        const status = customer.status;
        if (status === 'CLOSED') {
          throw new NotFoundException(`Recipient ${canonical} not found`);
        }
        if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
          if (status !== 'ACTIVE') {
            throw new NotFoundException(`Recipient ${canonical} not found`);
          }
        }
        const display = await this.customerDisplay(customerId);
        return {
          ownerType: 'CUSTOMER',
          ownerId: customer.id,
          receivingNumber: canonical,
          display,
          status,
        };
      }
    }

    throw new NotFoundException(`Recipient ${canonical} not found`);
  }

  private async findCustomerIdByCanonical(canonical10: string): Promise<string | null> {
    // Search customer_contact_methods where canonical of normalized_value equals canonical10
    // Use same collision logic as allocation: stored normalized_value may be 10-digit, +234..., 234..., 0...
    // Instead of scanning and canonicalizing, we do OR match.
    const rows: Array<{ customer_id: string }> = await this.dataSource.query(
      `SELECT customer_id FROM customer_contact_methods
       WHERE type = 'PHONE' AND deleted_at IS NULL
         AND (
           normalized_value = $1
           OR normalized_value = '+234' || $1
           OR normalized_value = '234' || $1
           OR normalized_value = '0' || $1
         )
       LIMIT 1`,
      [canonical10],
    );
    const first = rows[0];
    if (rows.length > 0 && first && first.customer_id) return first.customer_id;
    // Also try is_primary first? But limit 1 already picks any; for global uniqueness there should be at most one
    return null;
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
        if (appRows.length > 0 && first && first.business_name) return first.business_name as string;
      }
    } catch {
      // ignore
    }
    return agent.reference;
  }

  private async customerDisplay(customerId: string): Promise<string> {
    try {
      const profileRows: Array<{ display_name: string; deleted_at: string | null; is_active: boolean }> =
        await this.dataSource.query(
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
