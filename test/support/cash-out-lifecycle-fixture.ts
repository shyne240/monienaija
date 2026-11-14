import { randomBytes, randomUUID } from 'node:crypto';
import type { TestingModuleBuilder } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DataSource } from 'typeorm';

import { GovernedFinancialFixture } from './governed-financial-fixture';
import {
  createDeskOtpFixture,
  overrideSmsProvider,
  RecordingSmsProvider,
  type DeskOtpHandle,
} from './desk-otp-fixture';

/**
 * Reusable, test-only Cash-Out / governed-desk lifecycle helper.
 *
 * It exists so suites do not have to re-implement (or fabricate) the production lifecycle. It does
 * NOT bypass any production contract:
 *   - the cash-out intent is established by `AgentDeskOtpService.issue({ purpose: 'WALLET_TO_CASH' })`,
 *     which is the same call the desk API makes;
 *   - the OTP is whatever the governed issuer generated and the SMS adapter recorded;
 *   - the Agent session/credential and the institutional attribution are real rows produced through
 *     the supported provisioning paths.
 */
export interface GovernedDeskHarness {
  readonly smsProvider: RecordingSmsProvider;
  readonly deskOtp: DeskOtpHandle;
  readonly fixture: GovernedFinancialFixture;
  readonly institutionId: string;
  readonly dataSource: DataSource;
  /** Provider override to apply *before* `.compile()`. */
  sessionFor(agentId: string): string | undefined;
  /** Affiliate + attribute the Agent, and give it an ACTIVE credential and session. */
  provisionAgent(agentId: string, agentWalletId: string): Promise<string>;
  /** Enrol the Customer in the institution and attribute its wallet. */
  provisionCustomer(customerId: string, customerWalletId: string): Promise<void>;
  issueCashOutOtp(params: IssueCashOutOtpParams): Promise<IssuedCashOutOtp>;
}

export interface IssueCashOutOtpParams {
  agentId: string;
  customerId: string;
  amountMinor: string;
  operationKey?: string;
  supersedesOperationKey?: string;
  ttlSeconds?: number;
  agentSessionId?: string;
}

export interface IssuedCashOutOtp {
  challengeId: string;
  otp: string;
  operationKey: string;
}

export interface GovernedDeskHarnessStart {
  app: NestFastifyApplication;
  dataSource: DataSource;
  label?: string;
}

/** Provider override that must be applied to the testing module before `.compile()`. */
export function governedDeskProviderOverride(
  builder: TestingModuleBuilder,
  smsProvider: RecordingSmsProvider,
): TestingModuleBuilder {
  return overrideSmsProvider(builder, smsProvider);
}

export async function startGovernedDesk(
  params: GovernedDeskHarnessStart & { smsProvider: RecordingSmsProvider },
): Promise<GovernedDeskHarness> {
  const { app, dataSource, smsProvider } = params;
  const deskOtp = createDeskOtpFixture(app, smsProvider);
  const fixture = new GovernedFinancialFixture({
    app,
    dataSource,
    ...(params.label ? { label: params.label } : {}),
  });
  const institutionId = await fixture.institution();
  const sessions = new Map<string, string>();

  return {
    smsProvider,
    deskOtp,
    fixture,
    institutionId,
    dataSource,
    sessionFor: (agentId) => sessions.get(agentId),
    async provisionAgent(agentId, agentWalletId) {
      await fixture.affiliateAgent(agentId, institutionId);
      await fixture.attributeWallet(agentWalletId, institutionId);
      const [credential] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO agent_authentication_credentials
           (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status)
         VALUES ($1,'fixture-login-hash','PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`,
        [agentId],
      );
      const [session] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO agent_authentication_sessions
           (agent_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at)
         VALUES ($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+INTERVAL '1 hour',clock_timestamp())
         RETURNING id`,
        [agentId, credential!.id, randomBytes(32).toString('hex')],
      );
      sessions.set(agentId, session!.id);
      return session!.id;
    },
    async provisionCustomer(customerId, customerWalletId) {
      await fixture.enrolCustomer(customerId, institutionId, {
        targetStatus: 'ACTIVE',
        financialEligibility: 'ELIGIBLE',
      });
      await fixture.attributeWallet(customerWalletId, institutionId);
    },
    async issueCashOutOtp(input) {
      const agentSessionId = input.agentSessionId ?? sessions.get(input.agentId);
      if (!agentSessionId) {
        throw new Error('Cash-Out requires an authenticated Agent session');
      }
      await ensureCustomerCredential(dataSource, input.customerId);
      const operationKey = input.operationKey ?? `cashout-op-${randomUUID()}`;
      const issued = await deskOtp.issue({
        agentId: input.agentId,
        customerId: input.customerId,
        purpose: 'WALLET_TO_CASH',
        agentSessionId,
        amountMinor: input.amountMinor,
        currency: 'NGN',
        operationKey,
        supersedesOperationKey: input.supersedesOperationKey,
        ttlSeconds: input.ttlSeconds ?? 300,
      });
      return { challengeId: issued.challengeId, otp: issued.otp, operationKey };
    },
  };
}

/** The canonical verifier reconstructs its principal from an ACTIVE Customer credential. */
export async function ensureCustomerCredential(
  dataSource: DataSource,
  customerId: string,
): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `SELECT id FROM customer_authentication_credentials
      WHERE customer_id=$1 AND status='ACTIVE' AND deleted_at IS NULL LIMIT 1`,
    [customerId],
  );
  if (rows[0]) return rows[0]!.id;
  const created: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO customer_authentication_credentials
       (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status)
     VALUES ($1,$2,'PASSWORD','fixture-hash','PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
    [randomUUID(), customerId],
  );
  return created[0]!.id;
}
