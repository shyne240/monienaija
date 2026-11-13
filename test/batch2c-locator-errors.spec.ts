import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import type { AgentCashToCashClaimInput } from '../src/agent/agent-cash-to-cash-claim.types';

describe('locator claim errors', () => {
  const input = {
    senderPhone: '08031234567',
    transferNumber: '000001',
  } as unknown as Omit<AgentCashToCashClaimInput, 'transferId'> & {
    senderPhone: string;
    transferNumber: string;
  };
  function serviceWith(error: Error) {
    const service = Object.create(
      AgentCashToCashClaimService.prototype,
    ) as AgentCashToCashClaimService;
    jest.spyOn(service as never, 'resolveProtectedLocator').mockResolvedValue('transfer' as never);
    jest.spyOn(service, 'execute').mockRejectedValue(error);
    return service;
  }
  it.each([
    new ForbiddenException('private KYC detail'),
    new ConflictException('Customer is not eligible for financial access'),
  ])('masks customer-specific denials', async (error) => {
    try {
      await serviceWith(error).executeByLocator(input);
      throw new Error('expected rejection');
    } catch (caught) {
      expect(caught).toBeInstanceOf(HttpException);
      const result = caught as HttpException;
      expect(result.getStatus()).toBe(404);
      expect(result.getResponse()).toEqual({
        code: 'C2C_CLAIM_NOT_AVAILABLE',
        message: 'Claim not available',
      });
    }
  });
  it.each([
    new ConflictException('Trusted KYC evidence is unavailable'),
    new ConflictException({ code: 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED' }),
    new Error('database unavailable'),
  ])(
    'reports transient or ambiguous failures as recovery required without private details',
    async (error) => {
      try {
        await serviceWith(error).executeByLocator(input);
        throw new Error('expected rejection');
      } catch (caught) {
        expect(caught).toBeInstanceOf(HttpException);
        const result = caught as HttpException;
        expect(result.getStatus()).toBe(503);
        expect(result.getResponse()).toEqual({
          code: 'C2C_RETRY_REQUIRED',
          message: 'Claim outcome unavailable; recover before retrying',
        });
      }
    },
  );
});
