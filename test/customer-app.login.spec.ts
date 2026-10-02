/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { CustomerAppController } from '../src/customer-app/customer-app.controller';
import type { Customer } from '../src/customer/customer.entity';
import type { CustomerProfile } from '../src/customer/customer-profile.entity';
import type { CustomerContactMethod } from '../src/customer/customer-contact-method.entity';
import type { WalletAccount } from '../src/wallet/wallet-account.entity';
import type { Transfer } from '../src/transfer/transfer.entity';
import type { AuthenticationExecutionService } from '../src/customer-authentication/authentication-execution.service';
import type { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';

describe('CustomerAppController Login & Sessions (Unit Tests)', () => {
  let controller: CustomerAppController;
  let executionService: { authenticate: jest.Mock };
  let sessionService: { issue: jest.Mock; revoke: jest.Mock; revokeAllForCredential: jest.Mock };

  const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    executionService = {
      authenticate: jest.fn(),
    };
    sessionService = {
      issue: jest.fn().mockResolvedValue({
        accessToken: 'cust-sess-token-12345',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        principal: { customerId: CUSTOMER_ID },
        sessionId: 'sess-001',
      }),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForCredential: jest.fn().mockResolvedValue(undefined),
    };

    controller = new CustomerAppController(
      {} as Repository<Customer>,
      {} as Repository<CustomerProfile>,
      {} as Repository<CustomerContactMethod>,
      {} as Repository<WalletAccount>,
      {} as Repository<Transfer>,
      {} as any,
      {} as any,
      {} as any,
      sessionService as unknown as AuthenticationSessionService,
      executionService as unknown as AuthenticationExecutionService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  describe('login & loginAlias', () => {
    it('authenticates with Nigerian phone number', async () => {
      executionService.authenticate.mockResolvedValue({
        authenticated: true,
        customerId: CUSTOMER_ID,
        credentialId: 'cred-001',
        passwordVersion: 1,
      });

      const res = await controller.login({
        phone: '08012345678',
        password: 'ValidPassword123!',
      });

      expect(executionService.authenticate).toHaveBeenCalledWith({
        customerId: '08012345678',
        password: 'ValidPassword123!',
        actor: '08012345678',
      });
      expect(sessionService.issue).toHaveBeenCalled();
      expect(res.accessToken).toBe('cust-sess-token-12345');
      expect(res.customerId).toBe(CUSTOMER_ID);
    });

    it('authenticates with customer reference via identifier property', async () => {
      executionService.authenticate.mockResolvedValue({
        authenticated: true,
        customerId: CUSTOMER_ID,
        credentialId: 'cred-001',
        passwordVersion: 1,
      });

      const res = await controller.login({
        identifier: 'mn-8012345678',
        password: 'ValidPassword123!',
      });

      expect(executionService.authenticate).toHaveBeenCalledWith({
        customerId: 'mn-8012345678',
        password: 'ValidPassword123!',
        actor: 'mn-8012345678',
      });
      expect(res.accessToken).toBe('cust-sess-token-12345');
    });

    it('authenticates with customerId (UUID)', async () => {
      executionService.authenticate.mockResolvedValue({
        authenticated: true,
        customerId: CUSTOMER_ID,
        credentialId: 'cred-001',
        passwordVersion: 1,
      });

      const res = await controller.login({
        customerId: CUSTOMER_ID,
        password: 'ValidPassword123!',
      });

      expect(executionService.authenticate).toHaveBeenCalledWith({
        customerId: CUSTOMER_ID,
        password: 'ValidPassword123!',
        actor: CUSTOMER_ID,
      });
      expect(res.accessToken).toBe('cust-sess-token-12345');
    });

    it('loginAlias delegates to login', async () => {
      executionService.authenticate.mockResolvedValue({
        authenticated: true,
        customerId: CUSTOMER_ID,
        credentialId: 'cred-001',
        passwordVersion: 1,
      });

      const res = await controller.loginAlias({
        phone: '+2348012345678',
        password: 'ValidPassword123!',
      });

      expect(res.accessToken).toBe('cust-sess-token-12345');
    });

    it('throws BadRequestException if no identifier is provided', async () => {
      await expect(
        controller.login({
          password: 'ValidPassword123!',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException if authentication fails', async () => {
      executionService.authenticate.mockResolvedValue({
        authenticated: false,
        customerId: '08012345678',
        failureReason: 'INVALID_CREDENTIALS',
      });

      await expect(
        controller.login({
          phone: '08012345678',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns rotationRequired without session if credential requires rotation', async () => {
      executionService.authenticate.mockResolvedValue({
        authenticated: true,
        customerId: CUSTOMER_ID,
        credentialId: 'cred-001',
        passwordVersion: 1,
        rotationRequired: true,
      });

      const res = await controller.login({
        phone: '08012345678',
        password: 'TempPassword!',
      });

      expect(res).toEqual({
        rotationRequired: true,
        customerId: CUSTOMER_ID,
      });
      expect(sessionService.issue).not.toHaveBeenCalled();
    });
  });
});
