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

const WORKFORCE_TOKEN = 'workforce-token';
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
  const auditService = { record: jest.fn(), list: jest.fn(), listAudit: jest.fn() };
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
      if (token === WORKFORCE_TOKEN) {
        return {
          type: 'OPERATOR',
          principalId: 'https://issuer.test:operator',
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

  describe('customer self-service', () => {
    it('binds deposit creation to the authenticated customer, not to request input', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/deposits')
        .set(asCustomer(TOKEN_A))
        .set('idempotency-key', 'matrix-deposit-1')
        .send({ walletId: WALLET_A, amountMinor: '1000', currency: 'NGN' })
        .expect(201);

      expect(depositService.createDeposit).toHaveBeenCalledTimes(1);
      expect(depositService.createDeposit).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: WALLET_A,
          ownership: { kind: 'CUSTOMER_SELF', customerId: CUSTOMER_A },
        }),
      );
    });

    it('rejects spoofed ownership fields in the request body', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/deposits')
        .set(asCustomer(TOKEN_A))
        .set('idempotency-key', 'matrix-deposit-2')
        .send({ walletId: WALLET_A, amountMinor: '1000', currency: 'NGN', customerId: CUSTOMER_B });

      expect(response.status).toBe(400);
      expect(depositService.createDeposit).not.toHaveBeenCalled();
    });

    it('binds a customer transfer to the authenticated customer as source-wallet owner', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set(asCustomer(TOKEN_B))
        .set('idempotency-key', 'matrix-transfer-1')
        .send({
          sourceWalletId: WALLET_B,
          destinationWalletId: WALLET_A,
          amountMinor: '500',
          currency: 'NGN',
        })
        .expect(201);

      expect(transferService.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceWalletId: WALLET_B,
          destinationWalletId: WALLET_A,
          ownership: { kind: 'CUSTOMER_SELF', customerId: CUSTOMER_B },
        }),
      );
    });

    it('cannot widen a wallet listing with a foreign customerId query parameter', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/wallets?customerId=${CUSTOMER_B}`)
        .set(asCustomer(TOKEN_A))
        .expect(403);
      expect(walletService.listWallets).not.toHaveBeenCalled();

      await request(app.getHttpServer())
        .get('/api/v1/wallets')
        .set(asCustomer(TOKEN_A))
        .expect(200);
      expect(walletService.listWallets).toHaveBeenCalledWith(CUSTOMER_A);
    });

    it('routes customer-scoped reads through ownership-checked service methods', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/deposits/${DEPOSIT_A}`)
        .set(asCustomer(TOKEN_A))
        .expect(200);
      expect(depositService.getDepositForCustomer).toHaveBeenCalledWith(DEPOSIT_A, CUSTOMER_A);
      expect(depositService.getDeposit).not.toHaveBeenCalled();

      await request(app.getHttpServer())
        .get(`/api/v1/withdrawals/${WITHDRAWAL_A}`)
        .set(asCustomer(TOKEN_A))
        .expect(200);
      expect(withdrawalService.getWithdrawalForCustomer).toHaveBeenCalledWith(
        WITHDRAWAL_A,
        CUSTOMER_A,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/wallets/${WALLET_A}/balance`)
        .set(asCustomer(TOKEN_A))
        .expect(200);
      expect(walletService.getWalletBalanceForCustomer).toHaveBeenCalledWith(WALLET_A, CUSTOMER_A);

      await request(app.getHttpServer())
        .get(`/api/v1/wallets/${WALLET_A}/transactions`)
        .set(asCustomer(TOKEN_A))
        .expect(200);
      expect(transferService.getWalletTransactionsForCustomer).toHaveBeenCalledWith(
        WALLET_A,
        CUSTOMER_A,
        undefined,
        undefined,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/transfers/${TRANSFER_A}`)
        .set(asCustomer(TOKEN_A))
        .expect(200);
      expect(transferService.getTransferForCustomer).toHaveBeenCalledWith(TRANSFER_A, CUSTOMER_A);

      await request(app.getHttpServer())
        .get(`/api/v1/deposits?walletId=${WALLET_A}`)
        .set(asCustomer(TOKEN_A))
        .expect(200);
      expect(depositService.listDepositsForCustomer).toHaveBeenCalledWith(CUSTOMER_A, WALLET_A);
    });

    it('never lets a customer substitute another customer id as the wallet owner', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/withdrawals')
        .set(asCustomer(TOKEN_B))
        .set('idempotency-key', 'matrix-withdrawal-1')
        .send({ walletId: WALLET_A, amountMinor: '700', currency: 'NGN' })
        .expect(201);

      // The service receives customer B's identity, so the wallet-ownership check rejects customer
      // A's wallet; nothing is ever authorised by the supplied walletId alone.
      expect(withdrawalService.createWithdrawal).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: WALLET_A,
          ownership: { kind: 'CUSTOMER_SELF', customerId: CUSTOMER_B },
        }),
      );
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
        .set({ authorization: `Bearer ${WORKFORCE_TOKEN}` })
        .expect(401);
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

    it.each(operationalPaths)(
      'allows a workforce session holding internal:access on %s',
      async (path) => {
        await request(app.getHttpServer())
          .get(path)
          .set({ authorization: `Bearer ${WORKFORCE_TOKEN}` })
          .expect(200);
      },
    );

    it('denies a workforce session without internal:access', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/internal/readiness')
        .set({ authorization: `Bearer ${WORKFORCE_TOKEN_WITHOUT_SCOPE}` })
        .expect(403);
    });

    it('never resolves an operational route through the customer session service', async () => {
      sessionService.validate.mockClear();
      await request(app.getHttpServer())
        .get('/api/v1/internal/readiness')
        .set({ authorization: `Bearer ${WORKFORCE_TOKEN}` })
        .expect(200);
      expect(sessionService.validate).not.toHaveBeenCalled();
    });
  });

  describe('anonymous authentication and registration', () => {
    it('registers a customer anonymously', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .send({ reference: 'matrix-registration', type: 'INDIVIDUAL', actor: 'self-service' })
        .expect(201);
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
