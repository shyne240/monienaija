/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import { BadRequestException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import { CustomerRegistrationService } from '../src/customer-registration/customer-registration.service';
import { CustomerRegistrationPhoneChallenge } from '../src/customer-registration/customer-registration-phone-challenge.entity';
import { Customer } from '../src/customer/customer.entity';
import { CustomerContactMethod } from '../src/customer/customer-contact-method.entity';
import { CustomerProfile } from '../src/customer/customer-profile.entity';
import { CustomerAuthenticationCredential } from '../src/customer-authentication/customer-authentication-credential.entity';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { CustomerStatus } from '../src/customer/customer.enums';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';

describe('CustomerRegistrationService (Unit Tests)', () => {
  let service: CustomerRegistrationService;
  let provider: TestNotificationProvider;
  let challenges: Map<string, CustomerRegistrationPhoneChallenge>;
  let customers: Map<string, Customer>;
  let contacts: Map<string, CustomerContactMethod>;
  let profiles: Map<string, CustomerProfile>;
  let credentials: Map<string, CustomerAuthenticationCredential>;
  let wallets: Map<string, WalletAccount>;
  let ledgerAccounts: Map<string, LedgerAccount>;
  let auditLogs: Array<{ entityType: string; action: string; actor: string; values?: any }>;

  const mockRateLimit = {
    consume: jest.fn().mockResolvedValue(undefined),
  };

  const mockAudit = {
    record: jest.fn().mockImplementation((_manager, payload) => {
      auditLogs.push(payload);
      return Promise.resolve();
    }),
  };

  beforeEach(() => {
    challenges = new Map();
    customers = new Map();
    contacts = new Map();
    profiles = new Map();
    credentials = new Map();
    wallets = new Map();
    ledgerAccounts = new Map();
    auditLogs = [];
    provider = new TestNotificationProvider();

    const mockManager: Partial<EntityManager> = {
      getRepository: jest.fn().mockImplementation((entityTarget) => {
        if (entityTarget === CustomerRegistrationPhoneChallenge) {
          return {
            create: (data: any) => ({ ...data }),
            save: async (entity: any) => {
              if (Array.isArray(entity)) {
                entity.forEach((e) => challenges.set(e.id || e.normalizedPhone, e));
                return entity;
              }
              const id = entity.id || `chal-${challenges.size + 1}`;
              entity.id = id;
              challenges.set(id, entity);
              return entity;
            },
            findOne: async ({ where }: any) => {
              for (const c of challenges.values()) {
                if (where.normalizedPhone && c.normalizedPhone === where.normalizedPhone) return c;
              }
              return null;
            },
            createQueryBuilder: () => {
              let phoneFilter = '';
              const builder: any = {
                where: (_query: string, params: any) => {
                  phoneFilter = params.phone;
                  return builder;
                },
                andWhere: () => builder,
                orderBy: () => builder,
                setLock: () => builder,
                getMany: async () => {
                  return Array.from(challenges.values()).filter(
                    (c) => c.normalizedPhone === phoneFilter,
                  );
                },
                getOne: async () => {
                  const matches = Array.from(challenges.values()).filter(
                    (c) => c.normalizedPhone === phoneFilter,
                  );
                  return matches[matches.length - 1] ?? null;
                },
              };
              return builder;
            },
          };
        }
        if (entityTarget === CustomerContactMethod) {
          return {
            create: (data: any) => ({ ...data }),
            save: async (entity: any) => {
              const id = entity.id || `contact-${contacts.size + 1}`;
              entity.id = id;
              contacts.set(id, entity);
              return entity;
            },
            findOne: async ({ where }: any) => {
              for (const c of contacts.values()) {
                if (where.normalizedValue && c.normalizedValue === where.normalizedValue && c.deletedAt === null) {
                  return c;
                }
              }
              return null;
            },
          };
        }
        if (entityTarget === Customer) {
          return {
            create: (data: any) => ({ ...data }),
            save: async (entity: any) => {
              const id = entity.id || `cust-${customers.size + 1}`;
              entity.id = id;
              customers.set(id, entity);
              return entity;
            },
            findOne: async ({ where }: any) => {
              for (const c of customers.values()) {
                if (where.id && c.id === where.id) return c;
                if (where.reference && c.reference === where.reference) return c;
              }
              return null;
            },
          };
        }
        if (entityTarget === CustomerProfile) {
          return {
            create: (data: any) => ({ ...data }),
            save: async (entity: any) => {
              const id = entity.id || `prof-${profiles.size + 1}`;
              entity.id = id;
              profiles.set(id, entity);
              return entity;
            },
          };
        }
        if (entityTarget === CustomerAuthenticationCredential) {
          return {
            create: (data: any) => ({ ...data }),
            save: async (entity: any) => {
              const id = entity.id || `cred-${credentials.size + 1}`;
              entity.id = id;
              credentials.set(id, entity);
              return entity;
            },
          };
        }
        if (entityTarget === LedgerAccount) {
          return {
            create: (data: any) => ({ ...data }),
            save: async (entity: any) => {
              const id = entity.id || `ledger-${ledgerAccounts.size + 1}`;
              entity.id = id;
              ledgerAccounts.set(id, entity);
              return entity;
            },
          };
        }
        if (entityTarget === WalletAccount) {
          return {
            create: (data: any) => ({ ...data }),
            save: async (entity: any) => {
              const id = entity.id || `wallet-${wallets.size + 1}`;
              entity.id = id;
              wallets.set(id, entity);
              return entity;
            },
          };
        }
        return {
          create: (d: any) => d,
          save: (d: any) => Promise.resolve(d),
          findOne: () => Promise.resolve(null),
        };
      }),
    };

    const mockDataSource: Partial<DataSource> = {
      transaction: jest.fn().mockImplementation((...args: any[]) => {
        const callback = typeof args[0] === 'function' ? args[0] : args[1];
        return callback(mockManager);
      }),
    };

    service = new CustomerRegistrationService(
      mockDataSource as DataSource,
      mockRateLimit as any,
      mockAudit as any,
      provider,
    );
  });

  describe('normalizeNigerianPhone', () => {
    it('normalizes local 080... format to canonical and E.164', () => {
      const res = service.normalizeNigerianPhone('08012345678');
      expect(res.canonical).toBe('8012345678');
      expect(res.e164).toBe('+2348012345678');
    });

    it('normalizes +234 format', () => {
      const res = service.normalizeNigerianPhone('+2348012345678');
      expect(res.canonical).toBe('8012345678');
      expect(res.e164).toBe('+2348012345678');
    });

    it('normalizes bare 10-digit format', () => {
      const res = service.normalizeNigerianPhone('8012345678');
      expect(res.canonical).toBe('8012345678');
      expect(res.e164).toBe('+2348012345678');
    });

    it('rejects invalid numbers', () => {
      expect(() => service.normalizeNigerianPhone('12345')).toThrow(BadRequestException);
      expect(() => service.normalizeNigerianPhone('06012345678')).toThrow(BadRequestException);
    });
  });

  describe('OTP flow & Self-Service Registration Completion', () => {
    it('requests OTP, sends SMS, verifies OTP, and completes self-service registration with active status, password, and wallet', async () => {
      const phone = '08034567890';
      const otpRes = await service.requestOtp(phone, '127.0.0.1');
      expect(otpRes.status).toBe('OTP_REQUEST_ACCEPTED');
      expect(provider.sent).toHaveLength(1);
      expect(provider.sent[0]?.destination).toBe('+2348034567890');

      const match = /code is (\d{6})/.exec(provider.sent[0]?.message ?? '');
      expect(match).not.toBeNull();
      const code = match![1]!;

      // Verify OTP
      const verifyRes = await service.verifyOtp(phone, code);
      expect(verifyRes.status).toBe('PHONE_VERIFIED');
      expect(verifyRes.verificationToken).toBeTruthy();

      // Complete registration with password and display name
      const regRes = await service.completeRegistration(
        phone,
        verifyRes.verificationToken,
        '127.0.0.1',
        'SecurePass123!',
        'Adebayo Ogunlesi',
      );

      expect(regRes.id).toBeTruthy();
      expect(regRes.reference).toBe('mn-8034567890');
      expect(regRes.status).toBe(CustomerStatus.ACTIVE);
      expect(regRes.phone).toBe('+234*****7890');
      expect(regRes.wallet).toBeDefined();
      expect(regRes.wallet?.currency).toBe('NGN');
      expect(regRes.wallet?.status).toBe('ACTIVE');

      // Verify credential created
      expect(credentials.size).toBe(1);
      const cred = Array.from(credentials.values())[0];
      expect(cred?.customerId).toBe(regRes.id);
      expect(cred?.hashAlgorithm).toBe('PBKDF2');
      expect(cred?.passwordHash).toContain('PBKDF2$sha256$10000$');
      expect(cred?.rotationRequired).toBe(false);

      // Verify profile created
      expect(profiles.size).toBe(1);
      const prof = Array.from(profiles.values())[0];
      expect(prof?.displayName).toBe('Adebayo Ogunlesi');

      // Verify wallet & ledger account created
      expect(wallets.size).toBe(1);
      expect(ledgerAccounts.size).toBe(1);
      const wal = Array.from(wallets.values())[0];
      const led = Array.from(ledgerAccounts.values())[0];
      expect(wal?.ledgerAccountId).toBe(led?.id);
      expect(led?.currency).toBe('NGN');

      // Verify audit trail
      const auditActions = auditLogs.map((a) => `${a.entityType}/${a.action}`);
      expect(auditActions).toContain('CUSTOMER_REGISTRATION_CHALLENGE/OTP_REQUESTED');
      expect(auditActions).toContain('CUSTOMER_REGISTRATION_CHALLENGE/OTP_VERIFIED');
      expect(auditActions).toContain('CUSTOMER/CREATED');
      expect(auditActions).toContain('CUSTOMER/STATUS_UPDATED');
      expect(auditActions).toContain('CUSTOMER_CONTACT_METHOD/PHONE_VERIFIED');
      expect(auditActions).toContain('CUSTOMER_AUTHENTICATION_CREDENTIAL/CREATED');
      expect(auditActions).toContain('CUSTOMER_WALLET/PROVISIONED');

      // Audit logs must never contain raw password or verification token
      const auditDump = JSON.stringify(auditLogs);
      expect(auditDump).not.toContain('SecurePass123!');
      expect(auditDump).not.toContain(verifyRes.verificationToken);
    });

    it('rejects registration with already consumed verification token', async () => {
      const phone = '08099887766';
      await service.requestOtp(phone, '127.0.0.1');
      const code = /code is (\d{6})/.exec(provider.sent[0]?.message ?? '')![1]!;
      const verifyRes = await service.verifyOtp(phone, code);

      await service.completeRegistration(
        phone,
        verifyRes.verificationToken,
        '127.0.0.1',
        'SecurePass123!',
      );

      // Re-using the consumed token must fail
      await expect(
        service.completeRegistration(
          phone,
          verifyRes.verificationToken,
          '127.0.0.1',
          'SecurePass123!',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates DRAFT customer when password is omitted for backward-compatible workforce activation flow', async () => {
      const phone = '07011223344';
      await service.requestOtp(phone, '127.0.0.1');
      const code = /code is (\d{6})/.exec(provider.sent[0]?.message ?? '')![1]!;
      const verifyRes = await service.verifyOtp(phone, code);

      const regRes = await service.completeRegistration(
        phone,
        verifyRes.verificationToken,
        '127.0.0.1',
      );

      expect(regRes.status).toBe(CustomerStatus.DRAFT);
      expect(regRes.wallet).toBeUndefined();
      expect(credentials.size).toBe(0);
      expect(wallets.size).toBe(0);
    });
  });
});
