import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupportTickets1785753600064 implements MigrationInterface {
  name = 'CreateSupportTickets1785753600064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // V1-007 Support Ticket Lifecycle — operational support/dispute workflow for Customers/Agents/Workforce
    // This is NOT a chat/social system, NOT a second transaction engine, NOT a financial adjustment mechanism.
    // Tickets must never mutate balances or ledger; they only reference financial events (funding request, transfer).
    // Status state machine: OPEN → IN_PROGRESS → RESOLVED → CLOSED (OPEN may go directly to RESOLVED/CLOSED).
    // Assignment is explicit and auditable via assigned_to + audit/outbox. Messages support visible conversation;
    // internal notes (is_internal) are filtered from customer/agent views.

    await queryRunner.query(`
      CREATE TABLE support_tickets (
        id UUID PRIMARY KEY,
        reference VARCHAR(64) NOT NULL,
        customer_id UUID,
        agent_id UUID,
        created_by_type VARCHAR(20) NOT NULL,
        created_by_id VARCHAR(160) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        category VARCHAR(60) NOT NULL,
        description VARCHAR(4000) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        assigned_to VARCHAR(160),
        funding_request_id UUID,
        related_transfer_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT fk_support_tickets_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_support_tickets_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT fk_support_tickets_funding_request
          FOREIGN KEY (funding_request_id) REFERENCES customer_funding_requests(id) ON DELETE RESTRICT,
        CONSTRAINT fk_support_tickets_transfer
          FOREIGN KEY (related_transfer_id) REFERENCES transfers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_support_tickets_status CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
        CONSTRAINT chk_support_tickets_category CHECK (category IN ('FUNDING','TRANSFER','WALLET','CASH_IN','CASH_OUT','CASH_TO_CASH','PROFILE','PIN','AUTHENTICATION','AGENT_FUNDING','OUTLET','TERMINAL','OTHER')),
        CONSTRAINT chk_support_tickets_priority CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
        CONSTRAINT chk_support_tickets_created_by_type CHECK (created_by_type IN ('CUSTOMER','AGENT','SUPPORT','OPERATOR','SERVICE','PRIVILEGED')),
        CONSTRAINT chk_support_tickets_subject CHECK (length(subject) >= 3),
        CONSTRAINT chk_support_tickets_description CHECK (length(description) >= 3),
        CONSTRAINT chk_support_tickets_version CHECK (version > 0)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_support_tickets_reference ON support_tickets (reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_support_tickets_customer_created ON support_tickets (customer_id, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_support_tickets_agent_created ON support_tickets (agent_id, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_support_tickets_status_created ON support_tickets (status, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_support_tickets_assigned ON support_tickets (assigned_to)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_support_tickets_funding_request ON support_tickets (funding_request_id) WHERE funding_request_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_support_tickets_transfer ON support_tickets (related_transfer_id) WHERE related_transfer_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_support_tickets_reference ON support_tickets (reference)
    `);

    await queryRunner.query(`
      CREATE TABLE support_ticket_messages (
        id UUID PRIMARY KEY,
        ticket_id UUID NOT NULL,
        author_type VARCHAR(20) NOT NULL,
        author_id VARCHAR(160) NOT NULL,
        body VARCHAR(4000) NOT NULL,
        is_internal BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_support_ticket_messages_ticket
          FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
        CONSTRAINT chk_support_ticket_messages_author_type CHECK (author_type IN ('CUSTOMER','AGENT','SUPPORT','OPERATOR','SERVICE','PRIVILEGED')),
        CONSTRAINT chk_support_ticket_messages_body CHECK (length(body) >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_support_ticket_messages_ticket_created ON support_ticket_messages (ticket_id, created_at ASC, id ASC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS support_ticket_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS support_tickets`);
  }
}
