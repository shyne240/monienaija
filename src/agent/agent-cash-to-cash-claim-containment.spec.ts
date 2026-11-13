import { ServiceUnavailableException } from '@nestjs/common';
import { AgentCashToCashClaimService } from './agent-cash-to-cash-claim.service';
import type { AgentCashToCashClaimInput } from './agent-cash-to-cash-claim.types';

describe('Cash-to-Cash claim containment', () => {
  it('blocks claim before accessing any dependency, consuming an OTP or posting', async () => {
    const service = Object.create(
      AgentCashToCashClaimService.prototype,
    ) as AgentCashToCashClaimService;
    await expect(service.execute({} as AgentCashToCashClaimInput)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
