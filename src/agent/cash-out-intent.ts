import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { reserveCashOutOtpIssuance } from './cash-out-otp-budget';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CashOutIntentInput {
  institutionScope: string;
  agentId: string;
  agentSessionId?: string;
  customerId: string;
  credentialId: string;
  destinationHash: string;
  amountMinor?: string | number;
  currency?: string;
  operationKey?: string;
  supersedesOperationKey?: string;
}
export async function establishCashOutIntent(
  manager: EntityManager,
  input: CashOutIntentInput,
): Promise<string> {
  if (
    !input.agentSessionId ||
    !UUID.test(input.agentSessionId) ||
    !input.operationKey?.trim() ||
    input.operationKey.trim().length > 255 ||
    input.amountMinor === undefined ||
    !input.currency
  )
    throw new BadRequestException('Cash-out transaction context is required');
  if (input.institutionScope !== 'MONIENAIJA')
    throw new BadRequestException('Institution integration not supported by current schema');
  await requireCashOutAgentSession(manager, input.agentId, input.agentSessionId);
  const key = input.operationKey.trim();
  const amount = parsePositiveMinorUnits(input.amountMinor).toString();
  if (normalizeCurrency(input.currency) !== 'NGN')
    throw new BadRequestException('currency must be NGN');
  const previousKey = input.supersedesOperationKey?.trim();
  if (
    input.supersedesOperationKey !== undefined &&
    (!previousKey || previousKey.length > 255 || previousKey === key)
  )
    throw new BadRequestException('Invalid superseded operation');
  for (const lockKey of [key, ...(previousKey ? [previousKey] : [])].sort()) {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `cash-out:${input.agentId}:${lockKey}`,
    ]);
  }
  const wallets = await manager.query<Array<{ id: string; ledger_account_id: string }>>(
    `SELECT id,ledger_account_id FROM wallet_accounts WHERE customer_id=$1 AND currency='NGN' AND status='ACTIVE' AND owner_class='CUSTOMER' FOR SHARE`,
    [input.customerId],
  );
  const credentials = await manager.query<Array<{ password_version: number }>>(
    `SELECT password_version FROM customer_authentication_credentials WHERE id=$1 AND customer_id=$2 AND status='ACTIVE' AND deleted_at IS NULL FOR SHARE`,
    [input.credentialId, input.customerId],
  );
  if (!wallets[0] || !credentials[0])
    throw new BadRequestException('Cash-out wallet or credential unavailable');
  const existing = await manager.query<
    Array<{
      id: string;
      customer_id: string;
      credential_id: string;
      credential_version: number;
      source_wallet_id: string;
      source_ledger_id: string;
      agent_session_id: string;
      amount_minor: string;
      valid: boolean;
    }>
  >(
    `SELECT *, (status='ACTIVE' AND expires_at>clock_timestamp()) AS valid FROM cash_out_intents WHERE agent_id=$1 AND operation_key=$2 FOR UPDATE`,
    [input.agentId, key],
  );
  let supersededIntentId: string | undefined;
  if (previousKey) {
    // Replacement must be a genuinely new operation and belongs to the same agent
    // and customer. Lock the same intent row used by the execution boundary.
    if (existing[0]) throw new ConflictException('Replacement operation already exists');
    const previous = await manager.query<
      Array<{
        id: string;
        customer_id: string;
        institution_scope: string;
        status: string;
        amount_minor: string;
        source_wallet_id: string;
        valid: boolean;
      }>
    >(
      `SELECT id,customer_id,institution_scope,status,amount_minor::text,source_wallet_id,expires_at>clock_timestamp() AS valid FROM cash_out_intents WHERE agent_id=$1 AND operation_key=$2 FOR UPDATE`,
      [input.agentId, previousKey],
    );
    const old = previous[0];
    if (
      !old ||
      old.customer_id !== input.customerId ||
      old.institution_scope !== input.institutionScope ||
      old.status !== 'ACTIVE' ||
      !old.valid
    )
      throw new ConflictException('Superseded cash-out unavailable');
    if (old.amount_minor === amount && old.source_wallet_id === wallets[0].id)
      throw new ConflictException('Replacement must change a material detail');
    supersededIntentId = old.id;
    await manager.query(`UPDATE cash_out_intents SET status='CANCELLED' WHERE id=$1`, [old.id]);
    await manager.query(
      `UPDATE mfa_challenges SET status='REVOKED',revoked_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE cash_out_intent_id=$1 AND status='ACTIVE'`,
      [old.id],
    );
  }
  let id = existing[0]?.id;
  if (existing[0]) {
    const row = existing[0];
    if (
      !row.valid ||
      row.customer_id !== input.customerId ||
      row.credential_id !== input.credentialId ||
      row.credential_version !== credentials[0].password_version ||
      row.source_wallet_id !== wallets[0].id ||
      row.source_ledger_id !== wallets[0].ledger_account_id ||
      row.agent_session_id !== input.agentSessionId ||
      row.amount_minor !== amount
    )
      throw new ConflictException('Cash-out operation context does not match');
  } else {
    id = randomUUID();
    await manager.query(
      `INSERT INTO cash_out_intents(id,customer_id,credential_id,credential_version,source_wallet_id,source_ledger_id,agent_id,agent_session_id,institution_scope,operation_key,amount_minor,currency,purpose,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'MONIENAIJA',$9,$10,'NGN','WALLET_TO_CASH','ACTIVE',clock_timestamp()+interval '15 minutes')`,
      [
        id,
        input.customerId,
        input.credentialId,
        credentials[0].password_version,
        wallets[0].id,
        wallets[0].ledger_account_id,
        input.agentId,
        input.agentSessionId,
        key,
        amount,
      ],
    );
  }
  if (supersededIntentId) {
    await manager.query(
      `INSERT INTO audit_events (id,entity_type,entity_id,action,actor,new_values,occurred_at,created_at) VALUES ($1,'CASH_OUT_INTENT',$2,'SUPERSEDED',$3,$4,clock_timestamp(),clock_timestamp())`,
      [
        randomUUID(),
        supersededIntentId,
        `agent:${input.agentId}`,
        JSON.stringify({ status: 'CANCELLED', replacementIntentId: id }),
      ],
    );
  }
  await reserveCashOutOtpIssuance(
    manager,
    input.customerId,
    input.destinationHash,
    id,
    supersededIntentId,
  );
  return id!;
}

/** Revalidate the actual authenticated agent session while its authorization is used. */
export async function requireCashOutAgentSession(
  manager: EntityManager,
  agentId: string,
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId || !UUID.test(sessionId))
    throw new BadRequestException('Current agent session required');
  const agents = await manager.query<Array<{ id: string }>>(
    `SELECT id FROM agents WHERE id=$1 AND status='ACTIVE' AND deleted_at IS NULL FOR SHARE`,
    [agentId],
  );
  const rows = await manager.query<Array<{ eligible: boolean }>>(
    `SELECT (s.status='ACTIVE' AND s.revoked_at IS NULL AND s.audience='agent-api' AND s.expires_at>clock_timestamp() AND c.status='ACTIVE' AND c.deleted_at IS NULL AND c.rotation_required=FALSE AND c.account_locked=FALSE AND (c.password_expires_at IS NULL OR c.password_expires_at>clock_timestamp()) AND s.issued_at>=c.password_changed_at) AS eligible FROM agent_authentication_sessions s JOIN agent_authentication_credentials c ON c.id=s.credential_id AND c.agent_id=s.agent_id WHERE s.id=$1 AND s.agent_id=$2 FOR SHARE OF c,s`,
    [sessionId, agentId],
  );
  if (agents.length !== 1 || rows[0]?.eligible !== true)
    throw new BadRequestException('Agent session unavailable');
}
