import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { CustomerKycController } from '../src/customer-app/customer-kyc.controller';
import { CustomerKycViewService } from '../src/customer-app/customer-kyc-view.service';
import { DEFAULT_SESSION_AUDIENCE } from '../src/customer-authentication/authentication-session.service';
import { KycCustomerVerificationService } from '../src/kyc-verification/kyc-customer-verification.service';

const customerId = '89a95e6b-8d3c-47d5-92e0-8f91abf6c1b2';
const token = 'A'.repeat(43);
const principal: AuthorizationPrincipal = {
  type: 'CUSTOMER',
  principalId: customerId,
  customerId,
  roles: [],
  scopes: [],
  customerAccess: 'SELF',
};

type PrincipalRequest = FastifyRequest & { authorizationPrincipal?: AuthorizationPrincipal };

const verification = {
  status: jest.fn().mockResolvedValue({ verificationEnabled: true, history: [] }),
  availability: jest.fn().mockResolvedValue({
    status: 'AVAILABLE',
    provider: 'MONNIFY',
    routeVersion: 3,
    consentNotice: { version: 'notice-v1', text: 'An approved notice for this identity check.' },
  }),
  grantConsent: jest.fn().mockResolvedValue({
    id: 'e74f837e-3156-43b3-9864-966bf13e4801',
    expiresAt: '2026-11-16T00:00:00.000Z',
    provider: 'MONNIFY',
    routeVersion: 3,
  }),
  withdrawConsent: jest.fn().mockResolvedValue(undefined),
  verify: jest.fn().mockResolvedValue({
    id: 'fd20b04b-b10f-4b61-8a13-c4379518ef9b',
    status: 'MATCH',
    provider: 'MONNIFY',
    expiresAt: '2026-11-16T00:00:00.000Z',
  }),
};

let app: NestFastifyApplication;

beforeAll(async () => {
  const customerPrincipalGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest<PrincipalRequest>();
      request.authorizationPrincipal = principal;
      return true;
    },
  };
  const module = await Test.createTestingModule({
    controllers: [CustomerKycController],
    providers: [
      { provide: CustomerKycViewService, useValue: { view: jest.fn() } },
      { provide: KycCustomerVerificationService, useValue: verification },
      { provide: APP_GUARD, useValue: customerPrincipalGuard },
    ],
  }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  Object.values(verification).forEach((operation) => operation.mockClear());
});

async function post(path: string, payload: Record<string, unknown>, bearer = token) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/customers/me/kyc/${path}`,
    payload,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

describe('authenticated customer KYC controller routes', () => {
  it('wires the customer-self policy and versioned consent-bound actions to the customer audience', async () => {
    const policy = new RoutePolicyRegistry().resolve({
      method: 'POST',
      url: '/api/v1/customers/me/kyc/verification',
    });
    expect(policy.public).toBe(false);
    expect(policy.policy).toMatchObject({
      allowedPrincipalTypes: ['CUSTOMER'],
      customerAccess: 'SELF',
    });

    const status = await post('status', {});
    expect(status.statusCode).toBe(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(verification.status).toHaveBeenCalledWith(token, DEFAULT_SESSION_AUDIENCE);

    const availability = await post('availability', { kind: 'NIN' });
    expect(availability.statusCode).toBe(200);
    expect(verification.availability).toHaveBeenCalledWith(token, DEFAULT_SESSION_AUDIENCE, 'NIN');

    const requestId = '7549cb73-5005-452b-a2f0-78e217b785e9';
    const consent = await post('consent', {
      requestId,
      kind: 'NIN',
      accepted: true,
      noticeVersion: 'notice-v1',
      expectedProvider: 'MONNIFY',
      expectedRouteVersion: 3,
    });
    expect(consent.statusCode).toBe(200);
    expect(verification.grantConsent).toHaveBeenCalledWith({
      token,
      audience: DEFAULT_SESSION_AUDIENCE,
      requestId,
      kind: 'NIN',
      accepted: true,
      noticeVersion: 'notice-v1',
      expectedProvider: 'MONNIFY',
      expectedRouteVersion: 3,
    });

    const consentId = 'e74f837e-3156-43b3-9864-966bf13e4801';
    const withdrawal = await post('consent/withdraw', { consentId });
    expect(withdrawal.statusCode).toBe(200);
    expect(withdrawal.json()).toEqual({ status: 'WITHDRAWN' });
    expect(verification.withdrawConsent).toHaveBeenCalledWith({
      token,
      audience: DEFAULT_SESSION_AUDIENCE,
      consentId,
    });

    const verificationId = 'ab801b48-4036-45f1-ac50-21941d185b68';
    const result = await post('verification', {
      requestId: verificationId,
      consentId,
      kind: 'NIN',
      identifier: '91234567890',
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(verification.verify).toHaveBeenCalledWith({
      token,
      audience: DEFAULT_SESSION_AUDIENCE,
      requestId: verificationId,
      consentId,
      kind: 'NIN',
      identifier: '91234567890',
    });

    expect(
      (
        await post('verification', {
          requestId: verificationId,
          consentId,
          kind: 'NIN',
          identifier: 'not-an-identifier',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post('consent', {
          requestId,
          kind: 'NIN',
          accepted: false,
          noticeVersion: 'notice-v1',
          expectedProvider: 'MONNIFY',
          expectedRouteVersion: 3,
        })
      ).statusCode,
    ).toBe(400);
    expect(await post('status', {}, '')).toMatchObject({ statusCode: 401 });
  });
});
