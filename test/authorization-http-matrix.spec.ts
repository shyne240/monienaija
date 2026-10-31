import { APP_GUARD } from '@nestjs/core';
import { HttpException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
// Supertest uses CommonJS callable exports.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import type { DataSource } from 'typeorm';

import { AuthorizationService } from '../src/authorization/authorization.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { AgentAuthenticationSessionService } from '../src/agent-authentication/agent-authentication-session.service';
import { SupportAuthenticationService } from '../src/support-authentication/support-authentication.service';
import { A2SecurityRateLimitService } from '../src/authorization/security-rate-limit.service';
import type { A2RateLimitRuleV1 } from '../src/authorization/workforce-authentication.types';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { CustomerSessionController } from '../src/customer-authentication/customer-session.controller';
import {
  CUSTOMER_AUTH_ACCOUNT_CATEGORY,
  CUSTOMER_AUTH_IP_CATEGORY,
  CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS,
  CUSTOMER_AUTH_RATE_LIMIT_RULES,
} from '../src/customer-authentication/customer-authentication-rate-limit.config';
import { CustomerController } from '../src/customer/customer.controller';
import { CustomerService } from '../src/customer/customer.service';
import { ProductionController } from '../src/production/production.controller';
import { ApiVersionService } from '../src/production/api-version.service';
import { ProductionConfigurationService } from '../src/production/production-configuration.service';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
import { OperationsController } from '../src/operations/operations.controller';
import { AuditService } from '../src/operations/audit.service';
import { DiagnosticsService } from '../src/operations/diagnostics.service';
import { MetricsService } from '../src/operations/metrics.service';
import { OutboxService } from '../src/operations/outbox.service';
import { CustomerAuthenticationRuntimeService } from '../src/customer-authentication/customer-authentication-runtime.service';
import { DepositController } from '../src/deposit/deposit.controller';
import { DepositService } from '../src/deposit/deposit.service';
import { WithdrawalController } from '../src/withdrawal/withdrawal.controller';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import { TransferController } from '../src/transfer/transfer.controller';
import { TransferService } from '../src/transfer/transfer.service';
import { WalletTransactionController } from '../src/transfer/wallet-transaction.controller';
import { WalletController } from '../src/wallet/wallet.controller';
import { WalletService } from '../src/wallet/wallet.service';

const CUSTOMER_A = '00000000-0000-4000-8000-00000000000a';
const CUSTOMER_B = '00000000-0000-4000-8000-00000000000b';
const WALLET_A = '00000000-0000-4000-8000-0000000000a1';
const WALLET_B = '00000000-0000-4000-8000-0000000000b1';
const DEPOSIT_A = '00000000-0000-4000-8000-0000000000d1';
const WITHDRAWAL_A = '00000000-0000-4000-8000-0000000000e1';
const TRANSFER_A = '00000000-0000-4000-8000-0000000000f1';
const SESSION_A = '00000000-0000-4000-8000-0000000000a2';
const SESSION_B = '00000000-0000-4000-8000-0000000000b2';
const CREDENTIAL_A = '00000000-0000-4000-8000-0000000000a3';

// REPORT-32 H-01: catalogue-backed workforce fixtures replace the retired `internal:access`
// fixture. A real A2WorkforceSessionService copies the function codes of every ACTIVE catalogue
// role into `principal.scopes` (workforce-session.service.ts `resolve()`), so these fixtures mirror
// real session shapes instead of inventing a legacy internal scope no role is ever granted.
const FINANCE_AUDITOR_TOKEN = 'workforce-token-finance-auditor';
const OPERATIONS_TOKEN = 'workforce-token-operations';
const SUPPORT_TOKEN = 'workforce-token-support';
const LEGACY_INTERNAL_SCOPE_TOKEN = 'workforce-token-legacy-internal-scope';
const WORKFORCE_TOKEN_WITHOUT_SCOPE = 'workforce-token-noscope';
const TOKEN_A = 'session-token-customer-a';
const TOKEN_B = 'session-token-customer-b';

interface SessionFixture {
  customerId: string;
  sessionId: string;
  credentialId: string;
}

function sessionValidation(fixture: SessionFixture) {
  return {
    valid: true,
    principal: {
      principalType: 'CUSTOMER',
      customerId: fixture.customerId,
      credentialId: fixture.credentialId,
      sessionId: fixture.sessionId,
      audience: 'customer-api',
      authenticatedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    },
  };
}

/**
 * HTTP-level authorization matrix.
 *
 * The real route-policy registry, the real guard and the real authorization evaluator are used, so
 * every assertion below describes the deployed HTTP contract. Only the persistence-backed services
 * are replaced, which also lets each test prove that a denied request never reaches the money
 * movement service (zero calls, therefore zero ledger entries, zero balance change and zero state
 * mutation).
 */
describe('HTTP authorization matrix', () => {
  let app: NestFastifyApplication;
  const sessionService = {
    validate: jest.fn(),
    rotate: jest.fn(),
    revoke: jest.fn(),
    getSession: jest.fn(),
    revokeAllForCredential: jest.fn(),
  };
  const workforceSessions = { validate: jest.fn() };
  // INTEGRATION (integration/main-backend-frontend-20261030): the integrated RuntimeAccessGuard is
  // Lineage A's, which additionally resolves Agent and SUPPORT sessions (its V1-OPS-01 SUPPORT
  // fallback and its Agent-before-Customer resolution order). This suite was written against main's
  // guard, which had neither dependency, so its testing module could not compile the guard at all.
  // Both are supplied as NON-THROWING negatives: `agentSessionService.validate` is called first and
  // unguarded in the default branch, so a throwing mock would turn every default-branch route into a
  // 401 and mask the behaviour these cases assert. Returning `{ valid: false }` / `undefined`
  // reproduces exactly the "token is not an Agent/SUPPORT credential" fall-through this suite's
  // customer and workforce tokens rely on. No assertion in this file is relaxed by this.
  const agentSessionService = {
    validate: jest.fn().mockResolvedValue({ valid: false, reason: 'NOT_FOUND' }),
  };
  const supportAuthenticationService = {
    validate: jest.fn().mockResolvedValue(undefined),
  };
  const workforceConfig = {
    enabled: true,
    internalAudience: 'workforce-admin',
  } as A2WorkforceConfigurationV1;
  const dataSource = {
    transaction: async (run: (manager: unknown) => Promise<unknown>) => run({}),
  };
  const depositService = {
    createDeposit: jest.fn(),
    listDeposits: jest.fn(),
    listDepositsForCustomer: jest.fn(),
    getDeposit: jest.fn(),
    getDepositForCustomer: jest.fn(),
    completeDeposit: jest.fn(),
    failDeposit: jest.fn(),
    cancelDeposit: jest.fn(),
  };
  const withdrawalService = {
    createWithdrawal: jest.fn(),
    listWithdrawals: jest.fn(),
    listWithdrawalsForCustomer: jest.fn(),
    getWithdrawal: jest.fn(),
    getWithdrawalForCustomer: jest.fn(),
    processWithdrawal: jest.fn(),
    completeWithdrawal: jest.fn(),
    failWithdrawal: jest.fn(),
    cancelWithdrawal: jest.fn(),
  };
  const transferService = {
    createTransfer: jest.fn(),
    getTransfer: jest.fn(),
    getTransferForCustomer: jest.fn(),
    getWalletTransactions: jest.fn(),
    getWalletTransactionsForCustomer: jest.fn(),
  };
  const walletService = {
    listWallets: jest.fn(),
    getWallet: jest.fn(),
    getWalletForCustomer: jest.fn(),
    getWalletBalance: jest.fn(),
    getWalletBalanceForCustomer: jest.fn(),
    createWallet: jest.fn(),
  };
  const authenticationRuntime = { authenticateCustomer: jest.fn() };
  const customerService = {
    create: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    updateStatus: jest.fn(),
  };
  const apiVersionService = { getVersionMetadata: jest.fn() };
  const productionConfigurationService = { getSafeConfiguration: jest.fn() };
  const productionReadinessService = { getReadiness: jest.fn() };
  const diagnosticsService = { getDiagnostics: jest.fn() };
  const metricsService = { getMetrics: jest.fn() };
  const outboxService = { list: jest.fn(), listOutbox: jest.fn() };
  const auditService = {
    record: jest.fn(),
    list: jest.fn(),
    listAudit: jest.fn(),
    listWithNotificationProviderOversight: jest.fn(),
  };
  const securityRateLimits = {
    consume: jest.fn<Promise<void>, [A2RateLimitRuleV1, readonly string[], string]>(),
  };

  const mutationServices = [
    depositService,
    withdrawalService,
    transferService,
    walletService,
    authenticationRuntime,
    customerService,
    apiVersionService,
    productionConfigurationService,
    productionReadinessService,
    diagnosticsService,
    metricsService,
    outboxService,
    securityRateLimits,
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    agentSessionService.validate.mockResolvedValue({ valid: false, reason: 'NOT_FOUND' });
    supportAuthenticationService.validate.mockResolvedValue(undefined);
    for (const service of mutationServices) {
      for (const method of Object.values(service)) {
        method.mockResolvedValue({ id: 'ok' });
      }
    }
    sessionService.validate.mockImplementation(({ token }: { token: string }) => {
      if (token === TOKEN_A) {
        return sessionValidation({
          customerId: CUSTOMER_A,
          sessionId: SESSION_A,
          credentialId: CREDENTIAL_A,
        });
      }
      if (token === TOKEN_B) {
        return sessionValidation({
          customerId: CUSTOMER_B,
          sessionId: SESSION_B,
          credentialId: CREDENTIAL_A,
        });
      }
      return { valid: false, reason: 'NOT_FOUND' };
    });
    workforceSessions.validate.mockImplementation((token: string) => {
      if (token === 'workforce-token-noscope') {
        return {
          type: 'OPERATOR',
          principalId: 'https://issuer.test:operator-no-scope',
          sessionId: SESSION_A,
          audience: 'workforce-admin',
          roles: ['FINANCE_AUDITOR'],
          scopes: [],
          customerAccess: 'NONE',
          assuranceLevel: 'MFA',
        };
      }
      if (token === FINANCE_AUDITOR_TOKEN) {
        // SUPER_ADMIN/FINANCE_AUDITOR shape: holds every operational read function.
        return {
          type: 'OPERATOR',
          principalId: 'https://issuer.test:finance-auditor',
          sessionId: SESSION_A,
          audience: 'workforce-admin',
          roles: ['FINANCE_AUDITOR'],
          scopes: [
            'audit.view',
            'diagnostics.view',
            'metrics.view',
            'outbox.view',
            'reconciliation.view',
          ],
          customerAccess: 'NONE',
          assuranceLevel: 'MFA',
          readOnlyPrincipal: true,
        };
      }
      if (token === OPERATIONS_TOKEN) {
        // OPERATIONS shape: platform operations reads, but no reconciliation.view in V1.
        return {
          type: 'OPERATOR',
          principalId: 'https://issuer.test:operations',
          sessionId: SESSION_A,
          audience: 'workforce-admin',
          roles: ['OPERATIONS'],
          scopes: ['diagnostics.view', 'metrics.view', 'outbox.view'],
          customerAccess: 'NONE',
          assuranceLevel: 'MFA',
          readOnlyPrincipal: true,
        };
      }
      if (token === SUPPORT_TOKEN) {
        // Real SUPPORT principal shape (support-authentication.service.ts principalFor()).
        return {
          type: 'SUPPORT',
          principalId: 'support-user-1',
          sessionId: SESSION_A,
          audience: 'support-workforce',
          roles: ['SUPPORT'],
          scopes: ['support:ticket:read', 'customer.manage_support_case'],
          customerAccess: 'NONE',
          assuranceLevel: 'PASSWORD',
        };
      }
      if (token === LEGACY_INTERNAL_SCOPE_TOKEN) {
        // The retired fixture: a scope no catalogue role is ever granted. It must no longer be
        // sufficient for any internal operational route.
        return {
          type: 'OPERATOR',
          principalId: 'https://issuer.test:legacy-internal-scope',
          sessionId: SESSION_A,
          audience: 'workforce-admin',
          roles: ['FINANCE_AUDITOR'],
          scopes: ['internal:access'],
          customerAccess: 'NONE',
          assuranceLevel: 'MFA',
        };
      }
      throw new UnauthorizedException('Authentication required');
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [
        CustomerController,
        ProductionController,
        OperationsController,
        DepositController,
        WithdrawalController,
        TransferController,
        WalletTransactionController,
        WalletController,
        CustomerSessionController,
      ],
      providers: [
        RoutePolicyRegistry,
        {
          provide: AuthorizationService,
          useValue: new AuthorizationService(
            dataSource as unknown as DataSource,
            auditService as unknown as AuditService,
          ),
        },
        { provide: AuthenticationSessionService, useValue: sessionService },
        { provide: A2WorkforceSessionService, useValue: workforceSessions },
        { provide: AgentAuthenticationSessionService, useValue: agentSessionService },
        { provide: SupportAuthenticationService, useValue: supportAuthenticationService },
        { provide: A2_WORKFORCE_CONFIG, useValue: workforceConfig },
        { provide: APP_GUARD, useClass: RuntimeAccessGuard },
        { provide: AuditService, useValue: auditService },
        { provide: A2SecurityRateLimitService, useValue: securityRateLimits },
        { provide: CUSTOMER_AUTH_RATE_LIMIT_RULES, useValue: CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS },
        { provide: CustomerService, useValue: customerService },
        { provide: ApiVersionService, useValue: apiVersionService },
        { provide: ProductionConfigurationService, useValue: productionConfigurationService },
        { provide: ProductionReadinessService, useValue: productionReadinessService },
        { provide: DiagnosticsService, useValue: diagnosticsService },
        { provide: MetricsService, useValue: metricsService },
        { provide: OutboxService, useValue: outboxService },
        { provide: DepositService, useValue: depositService },
        { provide: WithdrawalService, useValue: withdrawalService },
        { provide: TransferService, useValue: transferService },
        { provide: WalletService, useValue: walletService },
        {
          provide: CustomerAuthenticationRuntimeService,
          useValue: authenticationRuntime,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const asCustomer = (token: string) => ({ authorization: `Bearer ${token}` });

  describe('anonymous callers', () => {
    it.each([
      ['get', '/api/v1/deposits'],
      ['post', '/api/v1/deposits'],
      ['get', '/api/v1/withdrawals'],
      ['post', '/api/v1/withdrawals'],
      ['post', '/api/v1/transfers'],
      ['get', '/api/v1/wallets'],
      ['get', `/api/v1/wallets/${WALLET_A}/balance`],
      ['get', `/api/v1/wallets/${WALLET_A}/transactions`],
      ['get', '/api/v1/internal/readiness'],
      ['get', '/api/v1/internal/diagnostics'],
      ['get', '/api/v1/internal/version'],
    ])('is rejected with 401 on %s %s', async (method, path) => {
      const agent = request(app.getHttpServer());
      const response = method === 'post' ? await agent.post(path).send({}) : await agent.get(path);
      expect(response.status).toBe(401);
    });

    it('never reaches the movement services', async () => {
      await request(app.getHttpServer()).post('/api/v1/deposits').send({}).expect(401);
      expect(depositService.createDeposit).not.toHaveBeenCalled();
      expect(depositService.completeDeposit).not.toHaveBeenCalled();
    });
  });

  /**
   * REPORT-32 remediation of obsolete expectations #2-#7 (see the remediation report).
   *
   * The selected V1 product boundary serves customers through `/customers/me/*` and keeps the
   * generic financial commands workforce-only: the integrated controllers (Lineage A) disable
   * those commands for customer principals outright. The superseded expectations asserted that a
   * customer could deposit, withdraw, transfer, list wallets and read deposit/withdrawal records
   * through the generic routes - they described main's alternative design, not this contract.
   *
   * They are replaced - not deleted - by real-HTTP assertions on the approved contract: every
   * generic customer financial command and read is denied with 403 and never reaches a
   * money-movement service. The positive side of the contract lives in
   * `test/runtime-access.guard.spec.ts` (CUSTOMER SELF resolution for `/customers/me/*`) and in
   * `src/customer-app/customer-app.controller.ts`, whose `POST /customers/me/transfers` derives
   * the `CUSTOMER_SELF` source-wallet binding from the session (request input cannot supply it).
   */
  describe('customer financial surface (selected /customers/me/* contract)', () => {
    it.each(['/api/v1/deposits', '/api/v1/withdrawals', '/api/v1/transfers'])(
      'denies a customer 403 on the generic command POST %s',
      async (path) => {
        await request(app.getHttpServer())
          .post(path)
          .set(asCustomer(TOKEN_A))
          .set('idempotency-key', `matrix-generic-${path}`)
          .send({
            walletId: WALLET_A,
            sourceWalletId: WALLET_A,
            destinationWalletId: WALLET_B,
            amountMinor: '1000',
            currency: 'NGN',
          })
          .expect(403);
      },
    );

    it('never reaches a money-movement service from a denied generic command', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/deposits')
        .set(asCustomer(TOKEN_A))
        .set('idempotency-key', 'matrix-denied-deposit')
        .send({ walletId: WALLET_A, amountMinor: '1000', currency: 'NGN' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/withdrawals')
        .set(asCustomer(TOKEN_A))
        .set('idempotency-key', 'matrix-denied-withdrawal')
        .send({ walletId: WALLET_A, amountMinor: '1000', currency: 'NGN' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set(asCustomer(TOKEN_B))
        .set('idempotency-key', 'matrix-denied-transfer')
        .send({
          sourceWalletId: WALLET_B,
          destinationWalletId: WALLET_A,
          amountMinor: '500',
          currency: 'NGN',
        })
        .expect(403);

      expect(depositService.createDeposit).not.toHaveBeenCalled();
      expect(withdrawalService.createWithdrawal).not.toHaveBeenCalled();
      expect(transferService.createTransfer).not.toHaveBeenCalled();
    });

    it('cannot widen reach by spoofing another customer id in the request body', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/deposits')
        .set(asCustomer(TOKEN_A))
        .set('idempotency-key', 'matrix-deposit-spoof')
        .send({ walletId: WALLET_A, amountMinor: '1000', currency: 'NGN', customerId: CUSTOMER_B });

      // Denied by route policy (403) rather than by body validation (400): the command does not
      // exist for customer principals at all, so no request shape can reach it.
      expect(response.status).toBe(403);
      expect(depositService.createDeposit).not.toHaveBeenCalled();
    });

    it.each([
      ['/api/v1/deposits'],
      ['/api/v1/withdrawals'],
      ['/api/v1/wallets'],
      ['/api/v1/wallets?customerId=' + CUSTOMER_B],
      ['/api/v1/deposits?walletId=' + WALLET_A],
      [`/api/v1/deposits/${DEPOSIT_A}`],
      [`/api/v1/withdrawals/${WITHDRAWAL_A}`],
      [`/api/v1/transfers/${TRANSFER_A}`],
      [`/api/v1/wallets/${WALLET_A}/balance`],
      [`/api/v1/wallets/${WALLET_A}/transactions`],
    ])('denies a customer 403 on the generic collection/read %s', async (path) => {
      await request(app.getHttpServer()).get(path).set(asCustomer(TOKEN_A)).expect(403);

      // No unscoped collection read and no cross-customer read can be served: none of the
      // workforce-oriented service entry points are reachable from a customer principal.
      expect(walletService.listWallets).not.toHaveBeenCalled();
      expect(walletService.getWalletBalance).not.toHaveBeenCalled();
      expect(depositService.listDeposits).not.toHaveBeenCalled();
      expect(depositService.getDeposit).not.toHaveBeenCalled();
      expect(withdrawalService.listWithdrawals).not.toHaveBeenCalled();
      expect(withdrawalService.getWithdrawal).not.toHaveBeenCalled();
      expect(transferService.getTransfer).not.toHaveBeenCalled();
      expect(transferService.getWalletTransactions).not.toHaveBeenCalled();
    });
  });

  describe('settlement and state-transition routes', () => {
    it.each([
      [`/api/v1/deposits/${DEPOSIT_A}/complete`, 'completeDeposit'],
      [`/api/v1/deposits/${DEPOSIT_A}/fail`, 'failDeposit'],
      [`/api/v1/deposits/${DEPOSIT_A}/cancel`, 'cancelDeposit'],
      [`/api/v1/withdrawals/${WITHDRAWAL_A}/process`, 'processWithdrawal'],
      [`/api/v1/withdrawals/${WITHDRAWAL_A}/complete`, 'completeWithdrawal'],
      [`/api/v1/withdrawals/${WITHDRAWAL_A}/fail`, 'failWithdrawal'],
      [`/api/v1/withdrawals/${WITHDRAWAL_A}/cancel`, 'cancelWithdrawal'],
    ])('denies customers with 403 on %s and mutates nothing', async (path, method) => {
      const service = path.includes('deposits') ? depositService : withdrawalService;
      const handler = (service as unknown as Record<string, jest.Mock>)[method];

      await request(app.getHttpServer())
        .post(path)
        .set(asCustomer(TOKEN_B))
        .send({ reason: 'impersonation attempt' })
        .expect(403);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('internal and cross-customer routes', () => {
    it.each([
      '/api/v1/internal/readiness',
      '/api/v1/internal/deployment',
      '/api/v1/internal/configuration',
      '/api/v1/internal/diagnostics',
      '/api/v1/internal/metrics',
      '/api/v1/internal/audit',
      '/api/v1/internal/outbox',
      '/api/v1/internal/version',
    ])('denies a customer 403 on %s', async (path) => {
      await request(app.getHttpServer()).get(path).set(asCustomer(TOKEN_A)).expect(403);
    });

    it('denies a customer access to another customer profile route', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/customers/${CUSTOMER_B}`)
        .set(asCustomer(TOKEN_A))
        .expect(403);
    });

    it('does not accept a workforce session token on customer routes', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/wallets')
        .set({ authorization: `Bearer ${FINANCE_AUDITOR_TOKEN}` })
        // REPORT-32 disposition #9: the principal is recognised but disallowed by route policy, so
        // 403 is the correct authorization result (previously mis-asserted as 401).
        .expect(403);
    });
  });

  describe('operational route access', () => {
    const operationalPaths = [
      '/api/v1/internal/readiness',
      '/api/v1/internal/deployment',
      '/api/v1/internal/configuration',
      '/api/v1/internal/diagnostics',
      '/api/v1/internal/metrics',
      '/api/v1/internal/audit',
      '/api/v1/internal/outbox',
      '/api/v1/internal/version',
    ];

    // REPORT-32 H-01 positive coverage: a principal holding the catalogue functions the policy
    // declares reaches every permitted internal operational endpoint.
    it.each(operationalPaths)(
      'allows a catalogue-privileged workforce session (FINANCE_AUDITOR shape) on %s',
      async (path) => {
        await request(app.getHttpServer())
          .get(path)
          .set({ authorization: `Bearer ${FINANCE_AUDITOR_TOKEN}` })
          .expect(200);
      },
    );

    // REPORT-32 H-01 negative coverage: a genuine SUPPORT session (read + funding-maker +
    // support-queue only, holding none of these catalogue functions) is denied on every gated
    // endpoint, and never reaches the underlying service.
    const gatedOperationalPaths = operationalPaths.filter(
      (path) => path !== '/api/v1/internal/audit',
    );
    it.each(gatedOperationalPaths)('denies a SUPPORT session 403 on %s', async (path) => {
      await request(app.getHttpServer())
        .get(path)
        .set({ authorization: `Bearer ${SUPPORT_TOKEN}` })
        .expect(403);
      expect(apiVersionService.getVersionMetadata).not.toHaveBeenCalled();
      expect(productionConfigurationService.getSafeConfiguration).not.toHaveBeenCalled();
      expect(productionReadinessService.getReadiness).not.toHaveBeenCalled();
      expect(diagnosticsService.getDiagnostics).not.toHaveBeenCalled();
      expect(metricsService.getMetrics).not.toHaveBeenCalled();
      expect(outboxService.list).not.toHaveBeenCalled();
    });

    // The approved product decision keeps the generic audit listing available to SUPPORT; it is
    // declared explicitly in the registry instead of being inherited from the un-gated catch-all.
    it('allows a SUPPORT session to read the generic audit listing (documented decision)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/internal/audit')
        .set({ authorization: `Bearer ${SUPPORT_TOKEN}` })
        .expect(200);
      expect(auditService.list).toHaveBeenCalled();
    });

    // Least privilege is per-route, not per-type: OPERATIONS holds metrics/diagnostics/outbox but
    // not reconciliation.view, so readiness/deployment (which embed reconciliation state) deny it
    // while the operational reads it does own are allowed.
    it.each([
      '/api/v1/internal/metrics',
      '/api/v1/internal/diagnostics',
      '/api/v1/internal/outbox',
      '/api/v1/internal/configuration',
      '/api/v1/internal/version',
    ])('allows an OPERATIONS-shape session on %s', async (path) => {
      await request(app.getHttpServer())
        .get(path)
        .set({ authorization: `Bearer ${OPERATIONS_TOKEN}` })
        .expect(200);
    });

    it.each(['/api/v1/internal/readiness', '/api/v1/internal/deployment'])(
      'denies an OPERATIONS-shape session 403 on %s (no reconciliation.view)',
      async (path) => {
        await request(app.getHttpServer())
          .get(path)
          .set({ authorization: `Bearer ${OPERATIONS_TOKEN}` })
          .expect(403);
        expect(productionReadinessService.getReadiness).not.toHaveBeenCalled();
      },
    );

    // The retired `internal:access` fixture must no longer grant anything: no catalogue role is
    // ever issued that scope, so a principal holding only it is not authorised.
    it.each(gatedOperationalPaths)(
      'denies a session holding only the retired internal:access scope 403 on %s',
      async (path) => {
        await request(app.getHttpServer())
          .get(path)
          .set({ authorization: `Bearer ${LEGACY_INTERNAL_SCOPE_TOKEN}` })
          .expect(403);
      },
    );

    it('denies a workforce session with no scopes at all 403 on every gated operational route', async () => {
      for (const path of gatedOperationalPaths) {
        await request(app.getHttpServer())
          .get(path)
          .set({ authorization: `Bearer ${WORKFORCE_TOKEN_WITHOUT_SCOPE}` })
          .expect(403);
      }
    });

    it('never resolves an operational route through the customer session service', async () => {
      sessionService.validate.mockClear();
      await request(app.getHttpServer())
        .get('/api/v1/internal/readiness')
        .set({ authorization: `Bearer ${FINANCE_AUDITOR_TOKEN}` })
        .expect(200);
      expect(sessionService.validate).not.toHaveBeenCalled();
    });
  });

  /**
   * REPORT-34 H-01-R1 — HTTP method parity.
   *
   * Fastify answers a HEAD request with the matching GET handler (bodies are suppressed, the
   * handler still runs). Route policies are keyed by `"<METHOD> <path>"`, so before the
   * remediation a HEAD request matched no operational policy and fell through to the generic,
   * un-gated `/internal/*` branch — which admits SUPPORT and declares no function requirement.
   * SUPPORT could therefore invoke readiness/deployment/configuration/version through HEAD.
   *
   * `RoutePolicyRegistry.resolve()` now resolves HEAD through the GET policy. These cases prove
   * the fix at both layers: the policy resolution is identical for HEAD and GET, and the real
   * HTTP surface denies/permits HEAD exactly as it does GET, with denied requests never reaching
   * the protected service.
   */
  describe('HEAD method parity with GET (REPORT-34 H-01-R1)', () => {
    const gatedPaths = [
      '/api/v1/internal/readiness',
      '/api/v1/internal/deployment',
      '/api/v1/internal/configuration',
      '/api/v1/internal/diagnostics',
      '/api/v1/internal/metrics',
      '/api/v1/internal/outbox',
      '/api/v1/internal/version',
    ];
    const allOperationalPaths = [...gatedPaths, '/api/v1/internal/audit'];

    function resolutionFor(method: string, path: string) {
      const resolution = new RoutePolicyRegistry().resolve({ method, url: path });
      // `action` intentionally records the real request method, so it is normalised away here.
      return {
        ...resolution,
        policy: resolution.policy ? { ...resolution.policy, action: 'normalised' } : undefined,
      };
    }

    it.each(allOperationalPaths)(
      'resolves HEAD through exactly the GET policy for %s',
      (path) => {
        expect(resolutionFor('HEAD', path)).toEqual(resolutionFor('GET', path));
      },
    );

    it.each(allOperationalPaths)(
      'never falls through to the un-gated generic internal policy on HEAD %s',
      (path) => {
        const head = new RoutePolicyRegistry().resolve({ method: 'HEAD', url: path });
        expect(head.resourceType).not.toBe('internal-route');
        // The gated operational routes exclude SUPPORT by principal type; the audit route admits
        // SUPPORT (approved exception) but must declare the audit.view function gate instead of
        // relying on the un-gated fallback.
        if (path.endsWith('/audit')) {
          expect(head.policy?.requiredFunctions).toEqual(['audit.view']);
        } else {
          expect(head.policy?.allowedPrincipalTypes).not.toContain('SUPPORT');
          expect((head.policy?.requiredFunctions?.length ?? 0) > 0).toBe(true);
        }
      },
    );

    // ---- negative coverage on HEAD -------------------------------------------------------
    it.each(allOperationalPaths)('denies anonymous HEAD 401 on %s', async (path) => {
      await request(app.getHttpServer()).head(path).expect(401);
      expect(productionReadinessService.getReadiness).not.toHaveBeenCalled();
      expect(apiVersionService.getVersionMetadata).not.toHaveBeenCalled();
      expect(auditService.list).not.toHaveBeenCalled();
    });

    it.each(allOperationalPaths)('denies a CUSTOMER HEAD 403 on %s', async (path) => {
      await request(app.getHttpServer())
        .head(path)
        .set(asCustomer(TOKEN_A))
        .expect(403);
      expect(productionReadinessService.getReadiness).not.toHaveBeenCalled();
      expect(apiVersionService.getVersionMetadata).not.toHaveBeenCalled();
      expect(auditService.list).not.toHaveBeenCalled();
    });

    it.each(gatedPaths)('denies a SUPPORT HEAD 403 on %s and never invokes the handler', async (path) => {
      await request(app.getHttpServer())
        .head(path)
        .set({ authorization: `Bearer ${SUPPORT_TOKEN}` })
        .expect(403);
      expect(apiVersionService.getVersionMetadata).not.toHaveBeenCalled();
      expect(productionConfigurationService.getSafeConfiguration).not.toHaveBeenCalled();
      expect(productionReadinessService.getReadiness).not.toHaveBeenCalled();
      expect(diagnosticsService.getDiagnostics).not.toHaveBeenCalled();
      expect(metricsService.getMetrics).not.toHaveBeenCalled();
      expect(outboxService.list).not.toHaveBeenCalled();
    });

    it.each(gatedPaths)(
      'denies a workforce principal holding only the retired internal:access scope on HEAD %s',
      async (path) => {
        await request(app.getHttpServer())
          .head(path)
          .set({ authorization: `Bearer ${LEGACY_INTERNAL_SCOPE_TOKEN}` })
          .expect(403);
        expect(productionReadinessService.getReadiness).not.toHaveBeenCalled();
      },
    );

    it.each(gatedPaths)('denies a scope-less workforce principal on HEAD %s', async (path) => {
      await request(app.getHttpServer())
        .head(path)
        .set({ authorization: `Bearer ${WORKFORCE_TOKEN_WITHOUT_SCOPE}` })
        .expect(403);
    });

    it.each(['/api/v1/internal/readiness', '/api/v1/internal/deployment'])(
      'denies an OPERATIONS-shape principal on HEAD %s (no reconciliation.view)',
      async (path) => {
        await request(app.getHttpServer())
          .head(path)
          .set({ authorization: `Bearer ${OPERATIONS_TOKEN}` })
          .expect(403);
        expect(productionReadinessService.getReadiness).not.toHaveBeenCalled();
      },
    );

    // ---- positive coverage on HEAD -------------------------------------------------------
    it.each(allOperationalPaths)(
      'allows a FINANCE_AUDITOR-shape principal on HEAD %s',
      async (path) => {
        await request(app.getHttpServer())
          .head(path)
          .set({ authorization: `Bearer ${FINANCE_AUDITOR_TOKEN}` })
          .expect(200);
      },
    );

    it.each([
      '/api/v1/internal/metrics',
      '/api/v1/internal/diagnostics',
      '/api/v1/internal/outbox',
      '/api/v1/internal/configuration',
      '/api/v1/internal/version',
    ])('allows an OPERATIONS-shape principal on HEAD %s', async (path) => {
      await request(app.getHttpServer())
        .head(path)
        .set({ authorization: `Bearer ${OPERATIONS_TOKEN}` })
        .expect(200);
    });

    it('allows the approved SUPPORT exception on HEAD /internal/audit', async () => {
      await request(app.getHttpServer())
        .head('/api/v1/internal/audit')
        .set({ authorization: `Bearer ${SUPPORT_TOKEN}` })
        .expect(200);
      expect(auditService.list).toHaveBeenCalled();
    });
  });

  /**
   * REPORT-34 H-01-R2 — the approved SUPPORT audit exception is SUPPORT-only.
   *
   * Retaining SUPPORT's documented audit read never authorised every other workforce principal:
   * the catalogue grants `audit.view` to SUPER_ADMIN and FINANCE_AUDITOR and deliberately not to
   * OPERATIONS. `GET /internal/audit` therefore requires `audit.view` from catalogue-governed
   * principals and exempts only SUPPORT.
   */
  describe('audit least privilege (REPORT-34 H-01-R2)', () => {
    it('allows SUPPORT (approved exception, not catalogue-governed)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/internal/audit')
        .set({ authorization: `Bearer ${SUPPORT_TOKEN}` })
        .expect(200);
      expect(auditService.list).toHaveBeenCalled();
    });

    it('allows FINANCE_AUDITOR, which holds audit.view', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/internal/audit')
        .set({ authorization: `Bearer ${FINANCE_AUDITOR_TOKEN}` })
        .expect(200);
      expect(auditService.list).toHaveBeenCalled();
    });

    it.each([
      ['OPERATIONS (holds metrics/diagnostics/outbox but not audit.view)', OPERATIONS_TOKEN],
      ['a principal holding only the retired internal:access scope', LEGACY_INTERNAL_SCOPE_TOKEN],
      ['a scope-less workforce principal', WORKFORCE_TOKEN_WITHOUT_SCOPE],
    ])('denies %s 403 on GET and HEAD audit, and never lists audit records', async (_label, token) => {
      await request(app.getHttpServer())
        .get('/api/v1/internal/audit')
        .set({ authorization: `Bearer ${token}` })
        .expect(403);
      await request(app.getHttpServer())
        .head('/api/v1/internal/audit')
        .set({ authorization: `Bearer ${token}` })
        .expect(403);
      expect(auditService.list).not.toHaveBeenCalled();
      expect(auditService.listWithNotificationProviderOversight).not.toHaveBeenCalled();
    });

    it('declares audit.view as the audit gate while exempting only SUPPORT', () => {
      const resolution = new RoutePolicyRegistry().resolve({
        method: 'GET',
        url: '/api/v1/internal/audit',
      });
      expect(resolution.policy?.requiredFunctions).toEqual(['audit.view']);
      expect(resolution.policy?.requiredFunctionsExemptPrincipalTypes).toEqual(['SUPPORT']);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
    });
  });

  describe('anonymous authentication and registration', () => {
    // REPORT-32 disposition #14/#15: anonymous self-service registration through the workforce
    // customer-creation command is superseded by the OTP registration lifecycle
    // (`POST /customers/registration/otp` -> `.../otp/verify` -> `POST /customers/registration`),
    // whose public status and abuse controls are asserted in test/runtime-access.guard.spec.ts and
    // the customer-onboarding suites. The workforce command itself must stay closed to anonymous
    // callers.
    it('denies anonymous access to the workforce customer-creation command', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .send({ reference: 'matrix-registration', type: 'INDIVIDUAL', actor: 'self-service' })
        .expect(401);
      expect(customerService.create).not.toHaveBeenCalled();
    });

    it('keeps the OTP registration front door public while the workforce command stays closed', () => {
      const registry = new RoutePolicyRegistry();
      expect(registry.isPublic('POST', '/api/v1/customers/registration/otp')).toBe(true);
      expect(registry.isPublic('POST', '/api/v1/customers/registration/otp/verify')).toBe(true);
      expect(registry.isPublic('POST', '/api/v1/customers/registration')).toBe(true);
      expect(registry.isPublic('POST', '/api/v1/customers')).toBe(false);
    });

    it('exchanges credentials for a session without returning credential material', async () => {
      authenticationRuntime.authenticateCustomer.mockResolvedValue({
        authenticated: true,
        customerId: CUSTOMER_A,
        session: {
          accessToken: 'issued-session-token',
          tokenType: 'Bearer',
          sessionId: SESSION_A,
          audience: 'customer-api',
          expiresAt: new Date('2026-01-01T01:00:00.000Z'),
          principal: { customerId: CUSTOMER_A },
        },
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/customers/${CUSTOMER_A}/authenticate`)
        .send({ password: 'correct horse battery staple' })
        .expect(200);

      expect(response.body).toMatchObject({
        authenticated: true,
        customerId: CUSTOMER_A,
        session: { accessToken: 'issued-session-token', sessionId: SESSION_A },
      });
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('credentialId');
      expect(authenticationRuntime.authenticateCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: CUSTOMER_A }),
      );
    });

    it('consumes the security rate limit per address and per account before verification', async () => {
      authenticationRuntime.authenticateCustomer.mockResolvedValue({
        authenticated: false,
        customerId: CUSTOMER_A,
        failureReason: 'INVALID_CREDENTIALS',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/customers/${CUSTOMER_A}/authenticate`)
        .send({ password: 'wrong-password-value' })
        .expect(401);

      const categories = securityRateLimits.consume.mock.calls.map((call) => call[0].category);
      expect(categories).toEqual([CUSTOMER_AUTH_IP_CATEGORY, CUSTOMER_AUTH_ACCOUNT_CATEGORY]);
      expect(securityRateLimits.consume.mock.calls[1]?.[1]).toEqual([CUSTOMER_A]);
    });

    it('fails closed with 429 and never verifies credentials once a bucket is exhausted', async () => {
      securityRateLimits.consume.mockRejectedValueOnce(
        new HttpException('Security request rate exceeded', 429),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/customers/${CUSTOMER_A}/authenticate`)
        .send({ password: 'correct horse battery staple' })
        .expect(429);

      expect(authenticationRuntime.authenticateCustomer).not.toHaveBeenCalled();
      expect(securityRateLimits.consume).toHaveBeenCalledTimes(1);
    });

    it('returns a generic 401 for invalid credentials and never echoes the password', async () => {
      authenticationRuntime.authenticateCustomer.mockResolvedValue({
        authenticated: false,
        customerId: CUSTOMER_A,
        failureReason: 'INVALID_CREDENTIALS',
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/customers/${CUSTOMER_A}/authenticate`)
        .send({ password: 'wrong-password-value' })
        .expect(401);

      expect(JSON.stringify(response.body)).not.toContain('wrong-password-value');
      expect(JSON.stringify(response.body)).not.toContain('INVALID_CREDENTIALS');
      expect(response.body).toMatchObject({ message: 'Invalid credentials' });
    });
  });

  describe('customer session lifecycle', () => {
    it('returns the current session for the session owner', async () => {
      sessionService.getSession.mockResolvedValue({
        id: SESSION_A,
        customerId: CUSTOMER_A,
        credentialId: CREDENTIAL_A,
        audience: 'customer-api',
        status: 'ACTIVE',
        issuedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
        lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
        revokedAt: null,
        version: 1,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customers/${CUSTOMER_A}/sessions/current`)
        .set(asCustomer(TOKEN_A))
        .expect(200);

      expect(response.body).toMatchObject({ sessionId: SESSION_A, customerId: CUSTOMER_A });
      expect(JSON.stringify(response.body)).not.toContain('token');
    });

    it('denies session lifecycle access across customers', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/customers/${CUSTOMER_B}/sessions/current`)
        .set(asCustomer(TOKEN_A))
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${CUSTOMER_B}/sessions`)
        .set(asCustomer(TOKEN_A))
        .expect(403);
      expect(sessionService.revokeAllForCredential).not.toHaveBeenCalled();
    });

    it('logs out the caller through the real session revocation path', async () => {
      sessionService.revoke.mockResolvedValue({ valid: false, reason: 'REVOKED' });

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${CUSTOMER_A}/sessions/current`)
        .set(asCustomer(TOKEN_A))
        .expect(200);

      expect(sessionService.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ token: TOKEN_A }),
      );
    });
  });
});
