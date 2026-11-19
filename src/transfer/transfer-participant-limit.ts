import type { EnforceInput } from '../limit-catalog/limit-enforcement.service';
import type { TransferParticipant } from './transfer-participant';

/** Build admission only from a participant resolved from a locked wallet and domain records. */
export function transferParticipantLimitInput(
  participant: TransferParticipant,
  facts: {
    direction: 'OUTGOING' | 'INCOMING';
    amountMinor: string;
    currency: string;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    now: Date;
  },
): EnforceInput {
  return {
    principalType: participant.type,
    principalId: participant.id,
    agentClassId: participant.agentClassId,
    product: 'WALLET_TRANSFER',
    currency: facts.currency,
    direction: facts.direction,
    channel: null,
    amountMinor: facts.amountMinor,
    idempotencyKey: facts.idempotencyKey,
    requestHash: facts.requestHash,
    correlationId: facts.correlationId,
    now: facts.now,
    walletLedgerAccountId: participant.wallet.ledgerAccountId,
    principalWalletCustomerId: participant.id,
    requireConfiguration: true,
    // Agent assignment rules are explicitly strict, without pretending an agent has a customer
    // KYC tier. Customer tier admission retains the established rollout contract.
    strictConfiguredRules: participant.type === 'AGENT',
    requireKycTierPolicy: participant.type === 'CUSTOMER',
    institutionId: participant.wallet.institutionId,
    serviceClass: null,
  };
}
