import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { FinancialCommandGateService } from '../src/authorization/financial-command-gate.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';

describe('FinancialCommandGateService', () => {
  let service: FinancialCommandGateService;
  let authorizationService: AuthorizationService;
  let approvalService: PrivilegedActionApprovalService;

  const mockPrincipal: AuthorizationPrincipal = {
    type: 'PRIVILEGED',
    principalId: 'test-principal',
    roles: ['FINANCE_ADMIN'],
    scopes: ['ledger:write', 'transfer:create'],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialCommandGateService,
        {
          provide: AuthorizationService,
          useValue: {
            authorize: jest.fn(),
          },
        },
        {
          provide: PrivilegedActionApprovalService,
          useValue: {
            consume: jest.fn(),
            consumeInTransaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FinancialCommandGateService>(FinancialCommandGateService);
    authorizationService = module.get<AuthorizationService>(AuthorizationService);
    approvalService = module.get<PrivilegedActionApprovalService>(PrivilegedActionApprovalService);
  });

  describe('authorize', () => {
    it('returns allowed when authorization service allows', async () => {
      jest.spyOn(authorizationService, 'authorize').mockResolvedValue({
        allowed: true,
        principalType: mockPrincipal.type,
        principalId: mockPrincipal.principalId,
        resourceType: 'ledger',
        action: 'ledger:write',
        evaluatedAt: new Date(),
        requiredScopes: ['ledger:write'],
        requiredRoles: [],
      });

      const result = await service.authorize({
        principal: mockPrincipal,
        resourceType: 'ledger',
        action: 'ledger:write',
        requiredScopes: ['ledger:write'],
      });

      expect(result.allowed).toBe(true);
    });

    it('returns not allowed when authorization service denies', async () => {
      jest.spyOn(authorizationService, 'authorize').mockResolvedValue({
        allowed: false,
        principalType: mockPrincipal.type,
        principalId: mockPrincipal.principalId,
        resourceType: 'ledger',
        action: 'ledger:write',
        evaluatedAt: new Date(),
        reason: 'SCOPE_MISSING',
        requiredScopes: ['ledger:write'],
        requiredRoles: [],
      });

      const result = await service.authorize({
        principal: mockPrincipal,
        resourceType: 'ledger',
        action: 'ledger:write',
        requiredScopes: ['ledger:write'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('A2 authorization denied: SCOPE_MISSING');
    });

    it('checks required scopes', async () => {
      const authorizeSpy = jest.spyOn(authorizationService, 'authorize').mockResolvedValue({
        allowed: true,
        principalType: mockPrincipal.type,
        principalId: mockPrincipal.principalId,
        resourceType: 'ledger',
        action: 'ledger:write',
        evaluatedAt: new Date(),
        requiredScopes: ['ledger:write'],
        requiredRoles: [],
      });

      await service.authorize({
        principal: mockPrincipal,
        resourceType: 'ledger',
        action: 'ledger:write',
        requiredScopes: ['ledger:write', 'ledger:reverse'],
      });

      expect(authorizeSpy).toHaveBeenCalledWith(
        mockPrincipal,
        expect.objectContaining({
          requiredScopes: ['ledger:write', 'ledger:reverse'],
        }),
        expect.any(Object),
      );
    });
  });

  describe('consumeApproval', () => {
    it('consumes approval successfully', async () => {
      jest.spyOn(approvalService, 'consumeInTransaction').mockResolvedValue({
        approved: true,
        approval: {
          id: 'approval-123',
          actionType: 'LEDGER_JOURNAL_POST',
          resourceType: 'ledger',
          resourceId: 'ledger-123',
          customerId: null,
          actionFingerprint: 'fingerprint-123',
          requesterPrincipalId: 'requester',
          approvedBy: 'approver',
          approvalScope: 'ledger:write',
          requiredAssurance: 'MFA',
          policy: {},
          status: PrivilegedActionApprovalStatus.CONSUMED,
          isEmergency: false,
          requestedAt: new Date(),
          expiresAt: new Date(Date.now() + 3600000),
          approvedAt: new Date(),
          rejectedAt: null,
          cancelledAt: null,
          consumedAt: new Date(),
          version: 1,
        },
      });

      const mockManager = {} as any;

      const result = await service.consumeApproval(mockManager, {
        approvalId: 'approval-123',
        actionType: 'LEDGER_JOURNAL_POST',
        actionFingerprint: 'fingerprint-123',
        principal: mockPrincipal,
        resourceType: 'ledger',
      });

      expect(result.approved).toBe(true);
    });

    it('returns not approved when approval is denied', async () => {
      jest.spyOn(approvalService, 'consumeInTransaction').mockResolvedValue({
        approved: false,
        reason: 'EXPIRED',
      });

      const mockManager = {} as any;

      const result = await service.consumeApproval(mockManager, {
        approvalId: 'approval-123',
        actionType: 'LEDGER_JOURNAL_POST',
        actionFingerprint: 'fingerprint-123',
        principal: mockPrincipal,
        resourceType: 'ledger',
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('Approval denied: EXPIRED');
    });
  });
});
