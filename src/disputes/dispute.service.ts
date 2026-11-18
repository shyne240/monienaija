import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';

/**
 * ARENA 3D Group 24 — complaints and transaction disputes.
 *
 * ## What this service is
 *
 * A register of **claims against a specific transaction**, with an investigation, a decision, an award, and
 * a record of whether the claimant was told. `SupportService` remains the conversation channel; a dispute is
 * the decidable claim.
 *
 * ## What this service is emphatically not
 *
 * **It cannot move money, and it has no code path that writes a journal, a wallet or an account.** An upheld
 * decision records that a named adjudicator concluded the customer should be made whole for a stated amount.
 * Executing the remedy then goes through `LedgerReversalGovernanceService` — which has its own approval,
 * maker-checker and ledger triggers — or through the existing approval machinery for another remedy.
 *
 * The separation is the point. If this service could also pay, then a support agent with dispute rights
 * would have an unaudited path to customer funds that bypasses reversal governance, and every financial
 * control in this system would have a hole shaped like the disputes desk. `remedy_execution_reference`
 * records the governed path that *did* execute; it is a pointer, never an authorization.
 *
 * ## Separation of duties is real
 *
 * An upheld claim cannot be decided by the person who raised it, and cannot be decided by the person who
 * investigated it. That is enforced in the schema, so a service bug or a direct SQL statement cannot
 * collapse the roles. A rejected claim has no such requirement: a decision that owes nothing is not a
 * financial act.
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Records a claim.
   *
   * Duplicate claims against the same transaction on the same grounds are refused: the schema has a unique
   * index, so a customer reopening the same complaint — or support entering it twice — surfaces as a
   * conflict rather than creating two claims that would later be awarded twice.
   */
  async raiseDispute(command: {
    customerId: string;
    transactionReference: string;
    channel: string;
    grounds: string;
    claimedAmountMinor: number;
    currency: string;
    statement: string;
    raisedByType: 'CUSTOMER' | 'SUPPORT' | 'OPERATOR' | 'SERVICE';
    raisedById: string;
    now?: Date;
  }): Promise<{ id: string; reference: string; status: string }> {
    const statement = (command.statement ?? '').trim();
    if (statement.length === 0) {
      throw new BadRequestException('A dispute must include the customer statement');
    }
    if (!Number.isInteger(command.claimedAmountMinor) || command.claimedAmountMinor <= 0) {
      throw new BadRequestException('A disputed amount must be a positive integer in minor units');
    }
    const transactionReference = (command.transactionReference ?? '').trim();
    if (transactionReference.length === 0) {
      throw new BadRequestException('A dispute must identify the transaction it concerns');
    }

    const reference = `dsp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)
      .toString(36)
      .padStart(4, '0')}`;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const result: unknown = await manager.query(
          `INSERT INTO transaction_disputes (
             reference, customer_id, transaction_reference, channel, grounds,
             claimed_amount_minor, currency, statement, raised_by_type, raised_by_id,
             opened_at, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OPEN')
           RETURNING id, reference, status`,
          [
            reference,
            command.customerId,
            transactionReference,
            command.channel,
            command.grounds,
            command.claimedAmountMinor,
            command.currency,
            statement.slice(0, 4000),
            command.raisedByType,
            command.raisedById,
            command.now ?? new Date(),
          ],
        );
        const row = this.rowsOf<{ id: string; reference: string; status: string }>(result)[0];
        if (!row) throw new Error('transaction_disputes insert returned no row');

        await this.appendEvent(manager, {
          disputeId: row.id,
          eventType: 'RAISED',
          detail: `Claim of ${command.claimedAmountMinor} ${command.currency} on grounds ${command.grounds}`,
          actor: command.raisedById,
          communicatedToCustomer: false,
        });
        await this.audit(manager, {
          disputeId: row.id,
          action: 'DISPUTE_RAISED',
          actor: command.raisedById,
          newValues: {
            grounds: command.grounds,
            channel: command.channel,
            claimedAmountMinor: command.claimedAmountMinor,
            currency: command.currency,
          },
        });

        return { id: row.id, reference: row.reference, status: row.status };
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'This customer already has an open or decided dispute for that transaction on those grounds',
        );
      }
      throw error;
    }
  }

  /**
   * Records an investigation.
   *
   * Findings are required and must be substantive: a disposition with no recorded reasoning is not
   * reviewable by a supervisor, a regulator or the customer.
   */
  async recordInvestigation(command: {
    disputeId: string;
    investigatedBy: string;
    findings: string;
    now?: Date;
  }): Promise<void> {
    const findings = (command.findings ?? '').trim();
    if (findings.length === 0) {
      throw new BadRequestException('An investigation must record findings');
    }

    await this.dataSource.transaction(async (manager) => {
      const dispute = await this.requireDispute(manager, command.disputeId);
      if (
        dispute.status === 'DECIDED' ||
        dispute.status === 'CLOSED' ||
        dispute.status === 'WITHDRAWN'
      ) {
        throw new ConflictException('A decided or closed dispute cannot be re-investigated');
      }
      if (dispute.investigatedBy !== null) {
        // A second investigation would overwrite the first without leaving a trace, and the first is the
        // record of what was concluded before the decision.
        throw new ConflictException(
          'This dispute already has an investigation; a second investigation must be a new dispute',
        );
      }

      await manager.query(
        `UPDATE transaction_disputes
            SET investigated_by = $2,
                investigated_at = $3,
                investigation_findings = $4,
                status = 'INVESTIGATING',
                updated_at = now(),
                version = version + 1
          WHERE id = $1`,
        [
          command.disputeId,
          command.investigatedBy,
          command.now ?? new Date(),
          findings.slice(0, 4000),
        ],
      );

      await this.appendEvent(manager, {
        disputeId: command.disputeId,
        eventType: 'INVESTIGATION_RECORDED',
        detail: findings.slice(0, 2000),
        actor: command.investigatedBy,
        communicatedToCustomer: false,
      });
      await this.audit(manager, {
        disputeId: command.disputeId,
        action: 'DISPUTE_INVESTIGATION_RECORDED',
        actor: command.investigatedBy,
        newValues: { investigatedBy: command.investigatedBy },
      });
    });
  }

  /**
   * Decides the claim.
   *
   * The award must be consistent with the outcome — full uphold equals the claim, partial is strictly
   * between zero and the claim, rejection and withdrawal are zero — and that consistency is enforced in the
   * schema as well as here. A typo must not be able to turn a rejection into a payout.
   */
  async decideDispute(command: {
    disputeId: string;
    decidedBy: string;
    outcome: 'UPHELD_IN_FULL' | 'UPHELD_IN_PART' | 'REJECTED' | 'WITHDRAWN';
    awardedAmountMinor: number;
    rationale: string;
    now?: Date;
  }): Promise<void> {
    const rationale = (command.rationale ?? '').trim();
    if (rationale.length === 0) {
      throw new BadRequestException('A decision must record its rationale');
    }

    await this.dataSource.transaction(async (manager) => {
      const dispute = await this.requireDispute(manager, command.disputeId);
      if (dispute.outcome !== null) {
        throw new ConflictException('This dispute has already been decided; an outcome is final');
      }
      if (dispute.status === 'WITHDRAWN') {
        throw new ConflictException('A withdrawn dispute cannot be decided');
      }

      const awarded = command.awardedAmountMinor;
      if (!Number.isInteger(awarded) || awarded < 0) {
        throw new BadRequestException('An award must be a non-negative integer in minor units');
      }
      this.assertAwardMatchesOutcome(command.outcome, awarded, Number(dispute.claimedAmountMinor));

      /*
       * Separation of duties, checked here for a clear error and in the schema for a durable guarantee.
       * `investigated_by` may be null when a claim is decided without a recorded investigation, which the
       * schema permits for a straightforward rejection; the raiser check always applies.
       */
      if (command.outcome === 'UPHELD_IN_FULL' || command.outcome === 'UPHELD_IN_PART') {
        if (command.decidedBy === dispute.raisedById) {
          throw new ConflictException('The claimant cannot adjudicate their own claim');
        }
        if (dispute.investigatedBy !== null && command.decidedBy === dispute.investigatedBy) {
          throw new ConflictException(
            'The investigator cannot adjudicate the claim they investigated; an upheld award needs a second person',
          );
        }
      }

      await manager.query(
        `UPDATE transaction_disputes
            SET decided_by = $2,
                decided_at = $3,
                outcome = $4,
                awarded_amount_minor = $5,
                decision_rationale = $6,
                status = 'DECIDED',
                updated_at = now(),
                version = version + 1
          WHERE id = $1`,
        [
          command.disputeId,
          command.decidedBy,
          command.now ?? new Date(),
          command.outcome,
          awarded,
          rationale.slice(0, 4000),
        ],
      );

      await this.appendEvent(manager, {
        disputeId: command.disputeId,
        eventType: 'DECIDED',
        detail: `${command.outcome} awarding ${awarded} of ${dispute.claimedAmountMinor}`,
        actor: command.decidedBy,
        communicatedToCustomer: false,
      });
      await this.audit(manager, {
        disputeId: command.disputeId,
        action: 'DISPUTE_DECIDED',
        actor: command.decidedBy,
        newValues: {
          outcome: command.outcome,
          awardedAmountMinor: awarded,
          claimedAmountMinor: Number(dispute.claimedAmountMinor),
        },
      });
    });
  }

  /**
   * Records that the claimant was actually informed of the decision.
   *
   * This is a separate act from deciding, and deliberately so. A decision the customer never received is not
   * a resolved dispute — it is precisely the thing that becomes a regulatory complaint. Conflating "we
   * decided" with "we told them" is how a bank convinces itself a case is closed when the customer is still
   * waiting.
   */
  async recordCustomerInformed(command: {
    disputeId: string;
    informedBy: string;
    detail: string;
    now?: Date;
  }): Promise<void> {
    const detail = (command.detail ?? '').trim();
    if (detail.length === 0) {
      throw new BadRequestException(
        'Informing the customer must record how and what was communicated',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const dispute = await this.requireDispute(manager, command.disputeId);
      if (dispute.outcome === null) {
        throw new ConflictException(
          'A customer cannot be informed of a decision that has not been made',
        );
      }
      if (dispute.customerInformedAt !== null) {
        throw new ConflictException('The customer has already been recorded as informed');
      }

      await manager.query(
        `UPDATE transaction_disputes
            SET customer_informed_at = $2, customer_informed_by = $3, updated_at = now(),
                version = version + 1
          WHERE id = $1`,
        [command.disputeId, command.now ?? new Date(), command.informedBy],
      );

      await this.appendEvent(manager, {
        disputeId: command.disputeId,
        eventType: 'CUSTOMER_INFORMED',
        detail: detail.slice(0, 2000),
        actor: command.informedBy,
        communicatedToCustomer: true,
      });
    });
  }

  /**
   * Records the governed financial path that executed the award.
   *
   * A pointer, not a payment. This service cannot verify the reference points at a real execution — doing so
   * would mean reading the ledger and effectively trusting its own write — so it records the claim that a
   * governed path executed and leaves verification to the ledger's own evidence. What it does guarantee is
   * that an award cannot be marked executed twice, and that a rejected claim cannot be marked executed at
   * all.
   */
  async recordRemedyExecution(command: {
    disputeId: string;
    remedyExecutionReference: string;
    recordedBy: string;
  }): Promise<void> {
    const reference = (command.remedyExecutionReference ?? '').trim();
    if (reference.length === 0) {
      throw new BadRequestException(
        'A remedy execution must reference the governed path that executed it',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const dispute = await this.requireDispute(manager, command.disputeId);
      if (dispute.outcome === null) {
        throw new ConflictException('A remedy cannot be executed before a decision');
      }
      if (Number(dispute.awardedAmountMinor) === 0) {
        throw new ConflictException('There is no award to execute for this outcome');
      }
      if (dispute.remedyExecutionReference !== null) {
        throw new ConflictException(
          'The award for this dispute has already been recorded as executed',
        );
      }

      await manager.query(
        `UPDATE transaction_disputes
            SET remedy_execution_reference = $2, updated_at = now(), version = version + 1
          WHERE id = $1`,
        [command.disputeId, reference.slice(0, 200)],
      );

      await this.audit(manager, {
        disputeId: command.disputeId,
        action: 'DISPUTE_REMEDY_EXECUTED',
        actor: command.recordedBy,
        newValues: { remedyExecutionReference: reference.slice(0, 200) },
      });
    });
  }

  /** Closes a decided dispute. Refused while the claimant has not been informed. */
  async closeDispute(command: { disputeId: string; closedBy: string; now?: Date }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const dispute = await this.requireDispute(manager, command.disputeId);
      if (dispute.status === 'CLOSED') {
        throw new ConflictException('This dispute is already closed');
      }
      if (dispute.outcome === null) {
        throw new ConflictException('An undecided dispute cannot be closed');
      }
      /*
       * The substantive rule of this group: closure requires that the customer was told.
       *
       * Leaving this to process means the last thing anyone does before closing is the thing most easily
       * skipped, and an un-informed customer is an escalation waiting to happen.
       */
      if (dispute.customerInformedAt === null) {
        throw new ConflictException(
          'A dispute cannot be closed until the claimant has been recorded as informed of the decision',
        );
      }
      if (Number(dispute.awardedAmountMinor) > 0 && dispute.remedyExecutionReference === null) {
        throw new ConflictException(
          'A dispute with an outstanding award cannot be closed before the remedy is recorded as executed',
        );
      }

      await manager.query(
        `UPDATE transaction_disputes
            SET status = 'CLOSED', closed_at = $2, updated_at = now(), version = version + 1
          WHERE id = $1`,
        [command.disputeId, command.now ?? new Date()],
      );

      await this.appendEvent(manager, {
        disputeId: command.disputeId,
        eventType: 'CLOSED',
        detail: 'Dispute closed',
        actor: command.closedBy,
        communicatedToCustomer: false,
      });
      await this.audit(manager, {
        disputeId: command.disputeId,
        action: 'DISPUTE_CLOSED',
        actor: command.closedBy,
        newValues: { outcome: dispute.outcome },
      });
    });
  }

  /** A dispute as an operator sees it. */
  async getDispute(disputeId: string): Promise<Record<string, unknown>> {
    const rows: unknown = await this.dataSource.query(
      `SELECT id, reference, customer_id, transaction_reference, channel, grounds,
              claimed_amount_minor, currency, statement, raised_by_type, raised_by_id,
              status, investigated_by, investigated_at, investigation_findings,
              decided_by, decided_at, outcome, awarded_amount_minor, decision_rationale,
              customer_informed_at, customer_informed_by, remedy_execution_reference,
              opened_at, closed_at, version
         FROM transaction_disputes
        WHERE id = $1`,
      [disputeId],
    );
    const row = this.rowsOf<Record<string, unknown>>(rows)[0];
    if (!row) throw new NotFoundException('Dispute not found');
    return row;
  }

  /** Events for a dispute, newest first. */
  async listEvents(disputeId: string): Promise<Array<Record<string, unknown>>> {
    const rows: unknown = await this.dataSource.query(
      `SELECT id, event_type, detail, actor, communicated_to_customer, occurred_at
         FROM transaction_dispute_events
        WHERE dispute_id = $1
        ORDER BY occurred_at DESC`,
      [disputeId],
    );
    return this.rowsOf<Record<string, unknown>>(rows);
  }

  /**
   * Disputes still owing the customer something.
   *
   * Deliberately returns three distinct populations rather than one count, because they need different
   * action: an undecided claim is work, a decided claim with no customer contact is a communication failure,
   * and a decided award with no execution is money owed.
   */
  async outstandingPosture(now = new Date()): Promise<{
    undecided: number;
    oldestUndecidedAgeSeconds: number | null;
    decidedNotInformed: number;
    awardedNotExecuted: number;
    totalOpen: number;
  }> {
    const rows: unknown = await this.dataSource.query(
      `SELECT
         count(*) FILTER (WHERE status IN ('OPEN', 'INVESTIGATING'))::int AS undecided,
         min(opened_at) FILTER (WHERE status IN ('OPEN', 'INVESTIGATING')) AS oldest_undecided,
         count(*) FILTER (WHERE outcome IS NOT NULL AND customer_informed_at IS NULL
                            AND status <> 'WITHDRAWN')::int AS decided_not_informed,
         count(*) FILTER (WHERE awarded_amount_minor > 0 AND remedy_execution_reference IS NULL
                            AND status <> 'WITHDRAWN')::int AS awarded_not_executed,
         count(*) FILTER (WHERE status IN ('OPEN', 'INVESTIGATING', 'DECIDED'))::int AS total_open
       FROM transaction_disputes`,
    );
    const row = this.rowsOf<{
      undecided: number;
      oldest_undecided: Date | string | null;
      decided_not_informed: number;
      awarded_not_executed: number;
      total_open: number;
    }>(rows)[0];

    const oldest = row?.oldest_undecided ? new Date(row.oldest_undecided) : null;
    return {
      undecided: Number(row?.undecided ?? 0),
      oldestUndecidedAgeSeconds: oldest
        ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000))
        : null,
      decidedNotInformed: Number(row?.decided_not_informed ?? 0),
      awardedNotExecuted: Number(row?.awarded_not_executed ?? 0),
      totalOpen: Number(row?.total_open ?? 0),
    };
  }

  // ---------------------------------------------------------------------------------------------

  private assertAwardMatchesOutcome(outcome: string, awarded: number, claimed: number): void {
    const fail = (message: string): never => {
      throw new BadRequestException(message);
    };
    if (outcome === 'REJECTED' && awarded !== 0) {
      fail('A rejected claim must award zero');
    }
    if (outcome === 'WITHDRAWN' && awarded !== 0) {
      fail('A withdrawn claim must award zero');
    }
    if (outcome === 'UPHELD_IN_FULL' && awarded !== claimed) {
      fail('A full uphold must award exactly the claimed amount');
    }
    if (outcome === 'UPHELD_IN_PART' && (awarded <= 0 || awarded >= claimed)) {
      fail('A partial uphold must award more than zero and less than the claimed amount');
    }
  }

  private async requireDispute(
    manager: EntityManager,
    disputeId: string,
  ): Promise<{
    id: string;
    status: string;
    outcome: string | null;
    claimedAmountMinor: string;
    awardedAmountMinor: string | null;
    raisedById: string;
    investigatedBy: string | null;
    customerInformedAt: Date | null;
    remedyExecutionReference: string | null;
  }> {
    const result: unknown = await manager.query(
      `SELECT id, status, outcome, claimed_amount_minor, awarded_amount_minor, raised_by_id,
              investigated_by, customer_informed_at, remedy_execution_reference
         FROM transaction_disputes
        WHERE id = $1
        FOR UPDATE`,
      [disputeId],
    );
    const row = this.rowsOf<{
      id: string;
      status: string;
      outcome: string | null;
      claimed_amount_minor: string;
      awarded_amount_minor: string | null;
      raised_by_id: string;
      investigated_by: string | null;
      customer_informed_at: Date | null;
      remedy_execution_reference: string | null;
    }>(result)[0];
    if (!row) throw new NotFoundException('Dispute not found');
    return {
      id: row.id,
      status: row.status,
      outcome: row.outcome,
      claimedAmountMinor: row.claimed_amount_minor,
      awardedAmountMinor: row.awarded_amount_minor,
      raisedById: row.raised_by_id,
      investigatedBy: row.investigated_by,
      customerInformedAt: row.customer_informed_at,
      remedyExecutionReference: row.remedy_execution_reference,
    };
  }

  private async appendEvent(
    manager: EntityManager,
    event: {
      disputeId: string;
      eventType: string;
      detail: string;
      actor: string;
      communicatedToCustomer: boolean;
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO transaction_dispute_events (dispute_id, event_type, detail, actor, communicated_to_customer)
       VALUES ($1,$2,$3,$4,$5)`,
      [event.disputeId, event.eventType, event.detail, event.actor, event.communicatedToCustomer],
    );
  }

  private async audit(
    manager: EntityManager,
    command: {
      disputeId: string;
      action: string;
      actor: string;
      newValues: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'TRANSACTION_DISPUTE',
      entityId: command.disputeId,
      action: command.action,
      actor: command.actor,
      newValues: command.newValues,
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private rowsOf<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    const first: unknown = result[0];
    const second: unknown = result[1];
    if (result.length === 2 && Array.isArray(first) && !Array.isArray(second)) return first as T[];
    return result as T[];
  }
}
