import { ServiceUnavailableException } from '@nestjs/common';
import { AgentCashToCashClaimService } from './agent-cash-to-cash-claim.service';
import { CashToCashClaimFinancialContext } from './cash-to-cash-claim-authorization';
import type { AgentCashToCashClaimInput } from './agent-cash-to-cash-claim.types';

describe('Cash-to-Cash claim containment', () => {
  it('does not manufacture production institutional authority', () => {
    expect(() => new CashToCashClaimFinancialContext().resolve({} as never, {} as never)).toThrow(
      ServiceUnavailableException,
    );
  });
  it('blocks claim before accessing any dependency, consuming an OTP or posting', async () => {
    const service = Object.create(
      AgentCashToCashClaimService.prototype,
    ) as AgentCashToCashClaimService;
    await expect(service.execute({} as AgentCashToCashClaimInput)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
