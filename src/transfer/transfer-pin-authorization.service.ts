import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentAuthenticationService } from '../agent-authentication/agent-authentication.service';
import { AgentPasswordHashVerificationService } from '../agent-authentication/agent-password-hash-verification.service';
import { CustomerTransactionPinService } from '../customer/customer-transaction-pin.service';
import { PasswordHashVerificationService } from '../customer-authentication/password-hash-verification.service';
import { PasswordHashAlgorithm } from '../customer-authentication/customer-authentication.enums';
import { paymentRequestHash, UUID_PATTERN } from '../payment/payment-support';

/** PIN failures commit in the PIN service; successful evidence is rechecked at posting. */
@Injectable()
export class TransferPinAuthorizationService {
  constructor(
    private readonly customers: CustomerTransactionPinService,
    private readonly customerVerifier: PasswordHashVerificationService,
    private readonly agents: AgentAuthenticationService,
    private readonly agentVerifier: AgentPasswordHashVerificationService,
  ) {}

  private binding(principal: AuthorizationPrincipal, quoteId: string, scopedKey: string) {
    const id =
      principal.type === 'CUSTOMER'
        ? principal.customerId
        : principal.type === 'AGENT'
          ? principal.agentId
          : undefined;
    if (
      !id ||
      !principal.sessionId ||
      !UUID_PATTERN.test(id) ||
      !UUID_PATTERN.test(principal.sessionId) ||
      !UUID_PATTERN.test(quoteId)
    )
      throw new UnauthorizedException('Authenticated self session is required');
    return {
      id,
      sessionId: principal.sessionId,
      requestHash: paymentRequestHash({
        purpose: 'WALLET_TRANSFER_CONFIRMATION',
        quoteId,
        principalType: principal.type,
        principalId: id,
        sessionId: principal.sessionId,
        idempotencyKey: scopedKey,
      }),
    };
  }

  async authorize(
    principal: AuthorizationPrincipal,
    quoteId: string,
    scopedKey: string,
    pin: string,
  ): Promise<string> {
    const binding = this.binding(principal, quoteId, scopedKey);
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin))
      throw new UnauthorizedException('Invalid transaction PIN');
    const financialBinding = { requestHash: binding.requestHash, sessionId: binding.sessionId };
    const result =
      principal.type === 'CUSTOMER'
        ? await this.customers.verifyTransactionPin(
            binding.id,
            { pin, actor: binding.id, financialBinding },
            {
              verify: (value, alg, hash) =>
                this.customerVerifier.verify(value, alg as PasswordHashAlgorithm, hash),
            },
          )
        : await this.agents.verifyTransactionPin(
            binding.id,
            { pin, actor: binding.id, financialBinding },
            this.agentVerifier,
          );
    if (!result.verified || !result.auditId)
      throw new UnauthorizedException('Transaction PIN verification failed');
    return result.auditId;
  }

  async assertWithManager(
    manager: EntityManager,
    principal: AuthorizationPrincipal,
    quoteId: string,
    scopedKey: string,
    auditId: string,
  ): Promise<void> {
    const binding = this.binding(principal, quoteId, scopedKey);
    if (!auditId || !UUID_PATTERN.test(auditId))
      throw new UnauthorizedException('Transaction PIN authorization is unavailable');
    const customer = principal.type === 'CUSTOMER';
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT p.id FROM ${customer ? 'customer_transaction_pins' : 'agent_transaction_pins'} p
       JOIN audit_events a ON a.entity_id=p.id
       WHERE p.${customer ? 'customer_id' : 'agent_id'}=$1 AND p.deleted_at IS NULL AND NOT p.account_locked
         AND a.id=$2 AND a.entity_type=$3 AND a.action='PIN_VERIFIED' AND a.actor=$1::text
         AND a.new_values->>'financialRequestHash'=$4 AND a.new_values->>'sessionId'=$5
         AND a.new_values->>'pinVersion'=p.pin_version::text AND p.last_changed_at<=a.occurred_at
       FOR SHARE OF p`,
      [
        binding.id,
        auditId,
        customer ? 'CUSTOMER_TRANSACTION_PIN' : 'AGENT_TRANSACTION_PIN',
        binding.requestHash,
        binding.sessionId,
      ],
    );
    if (rows.length !== 1)
      throw new UnauthorizedException('Transaction PIN authorization is no longer active');
  }
}
