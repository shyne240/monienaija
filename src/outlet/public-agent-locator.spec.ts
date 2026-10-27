import { BadRequestException } from '@nestjs/common';

import { RoutePolicyRegistry } from '../authorization/route-policy-registry';
import { OutletService } from './outlet.service';

describe('Public Cash-to-Cash agent locator', () => {
  it('filters by state/city and returns a privacy-limited active eligible outlet projection', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([
        {
          display_name: null,
          address_line: '12 Example Street',
          city: 'Abuja',
          state: 'FCT',
          country: 'NG',
          agent_id: 'must-not-be-returned',
          reference: 'must-not-be-returned',
          code: 'must-not-be-returned',
        },
      ]);
    const service = new OutletService({ query } as never, {} as never);

    const result = await service.listPublicCashToCashOutlets({
      state: ' FCT ',
      city: 'Abuja',
      page: '2',
      limit: '25',
    });

    expect(result).toEqual({
      data: [
        {
          name: 'Cash-to-Cash service outlet',
          address: '12 Example Street',
          city: 'Abuja',
          state: 'FCT',
          country: 'NG',
        },
      ],
      page: 2,
      limit: 25,
      total: 1,
      pages: 1,
      filters: { state: 'FCT', city: 'Abuja' },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-be-returned');
    const recordedCalls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    const directorySql = recordedCalls[1]?.[0] ?? '';
    expect(directorySql).toContain("o.status = 'ACTIVE'");
    expect(directorySql).toContain("a.status = 'ACTIVE'");
    expect(directorySql).toContain('ac.is_active = TRUE');
    expect(directorySql).toContain("'CASH_TO_CASH'");
    expect(recordedCalls[1]?.[1]).toEqual(['FCT', 'Abuja', 25, 25]);
  });

  it('rejects oversized filters and exposes the exact read route publicly without opening internal outlets', async () => {
    const service = new OutletService({ query: jest.fn() } as never, {} as never);
    await expect(
      service.listPublicCashToCashOutlets({ state: 'x'.repeat(101) }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const registry = new RoutePolicyRegistry();
    expect(
      registry.resolve({
        method: 'GET',
        url: '/api/v1/public/agents/cash-to-cash-outlets?state=FCT',
      }).public,
    ).toBe(true);
    expect(
      registry.resolve({ method: 'GET', url: '/api/v1/internal/agents/abc/outlets' }).public,
    ).toBe(false);
  });
});
