import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommercialRulesScreen } from '../src/screens/authenticated/CommercialRulesScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));
function session(scopes: string[], id = 'one') {
  useAuthStore.setState({
    isAuthenticated: true,
    token: id,
    sessionId: id,
    principal: {
      type: 'OPERATOR',
      principalId: 'synthetic',
      sessionId: id,
      audience: 'workforce-admin',
      roles: ['FINANCE_CONTROLLER'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}
function page(data: object[], number = 1, total = data.length) {
  return {
    data,
    total,
    page: number,
    limit: 20,
    totalPages: Math.ceil(total / 20),
    hasNextPage: number < Math.ceil(total / 20),
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => jest.clearAllMocks());

test('fee registry shows real backend fields, pages independently and searches only current visible columns', async () => {
  session(['fee_rule.view']);
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('page=2')
        ? page(
            [
              {
                id: 'fee-two',
                productCode: 'CASH_OUT',
                currency: 'USD',
                flatFeeMinor: '1234',
                isActive: false,
              },
            ],
            2,
            21,
          )
        : page(
            [
              {
                id: 'fee-one',
                productCode: 'TRANSFER',
                currency: 'NGN',
                flatFeeMinor: '100',
                isActive: true,
              },
            ],
            1,
            21,
          ),
    ),
  );
  render(<CommercialRulesScreen initialTab="fees" />);
  expect(await screen.findAllByText('fee-one')).toBeTruthy();
  expect(screen.getByText(/Highest priority wins first, then the most matching target dimensions/)).toBeTruthy();
  expect(screen.getByText('21 total records · Page 1 of 2')).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Rule ID' })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Active' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search Fees on this page'), {
    target: { value: 'missing' },
  });
  expect(screen.getByText('No records match this search on the current page.')).toBeTruthy();
  expect(screen.getByText('21 total records · Page 1 of 2 · 0 matching on this page')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search Fees on this page'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next Fees page' }));
  expect(await screen.findAllByText('fee-two')).toBeTruthy();
  expect(screen.getByText('21 total records · Page 2 of 2')).toBeTruthy();
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/fee-rules?page=2&limit=20');
  expect(
    (screen.getByRole('button', { name: 'Next Fees page' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('limit profiles and rules have independent paging and failure states', async () => {
  session(['limit.view']);
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('limit-profiles'))
      return Promise.resolve(
        url.includes('page=2')
          ? page(
              [
                {
                  code: 'PROFILE_B',
                  name: 'Second',
                  kind: 'AGENT',
                  status: 'ACTIVE',
                  enabled: true,
                  configurationStatus: 'CONFIGURED',
                  version: 1,
                },
              ],
              2,
              21,
            )
          : page(
              [
                {
                  code: 'PROFILE_A',
                  name: 'First',
                  kind: 'AGENT',
                  status: 'ACTIVE',
                  enabled: true,
                  configurationStatus: 'CONFIGURED',
                  version: 1,
                },
              ],
              1,
              21,
            ),
      );
    return Promise.reject(new Error('Rules unavailable'));
  });
  render(<CommercialRulesScreen initialTab="limits" />);
  await screen.findAllByText('PROFILE_A');
  expect(await screen.findByText(/Rules unavailable/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next Limit profiles page' }));
  await screen.findAllByText('PROFILE_B');
  expect(screen.getByText(/Rules unavailable/)).toBeTruthy();
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-profiles?page=2&limit=20');
  expect(
    (ApiClient.get as jest.Mock).mock.calls.filter(([url]) => url.includes('limit-rules')),
  ).toHaveLength(1);
});

test('incorrect pagination is an error, not a fabricated empty catalogue', async () => {
  session(['product.view']);
  (ApiClient.get as jest.Mock).mockResolvedValue({ ...page([], 1, 0), hasNextPage: true });
  render(<CommercialRulesScreen initialTab="products" />);
  expect(await screen.findByText(/Products returned an invalid page/)).toBeTruthy();
  expect(screen.queryByText(/No products were returned/)).toBeNull();
});

test('tab and session changes do not show late registry results or preserve the search', async () => {
  session(['fee_rule.view', 'commission_rule.view']);
  const late = deferred<unknown>();
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    url.includes('fee-rules')
      ? late.promise
      : Promise.resolve(page([{ id: 'commission', productCode: 'TRANSFER' }])),
  );
  render(<CommercialRulesScreen initialTab="fees" />);
  fireEvent.change(screen.getByLabelText('Search Fees on this page'), {
    target: { value: 'old search' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Commissions' }));
  await screen.findAllByText('commission');
  await act(async () => {
    late.resolve(page([{ id: 'stale-fee' }]));
    await late.promise;
  });
  expect(screen.queryByText('stale-fee')).toBeNull();
  act(() => session(['fee_rule.view'], 'two'));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Commissions' })).toBeNull());
  expect((screen.getByLabelText('Search Fees on this page') as HTMLInputElement).value).toBe('');
});

test('an unpaginated legacy array is explicitly labelled and does not invent a total', async () => {
  session(['reward_rule.view']);
  (ApiClient.get as jest.Mock).mockResolvedValue([{ id: 'reward-one', productCode: 'TRANSFER' }]);
  render(<CommercialRulesScreen initialTab="rewards" />);
  expect(await screen.findAllByText('reward-one')).toBeTruthy();
  expect(screen.getByText('1 record returned · Total and pagination unavailable')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Next Rewards page' })).toBeNull();
});

test('limit catalogue rejects malformed and duplicate thresholds while isolating profiles', async () => {
  session(['limit.view']);
  const profile = {
    code: 'VALID_PROFILE',
    name: 'Agent profile',
    kind: 'AGENT',
    status: 'ACTIVE',
    enabled: true,
    configurationStatus: 'CONFIGURED',
    version: 1,
    unrecognized: { secret: 'PRIVATE' },
  };
  const rule = {
    id: 'd9f831b1-3166-4e9c-b812-955fc6b0818e',
    limitProfileCode: 'VALID_PROFILE',
    product: 'TRANSFER',
    direction: null,
    channel: null,
    currency: 'NGN',
    dimension: 'DAILY_AMOUNT',
    limitValueMinor: '10000000000000001',
    limitValueCount: null,
    version: 1,
    effectiveFrom: '2026-01-01T00:00:00Z',
    effectiveTo: null,
    isActive: true,
    priority: 0,
  };
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('limit-profiles') ? page([profile]) : page([{ ...rule, limitValueCount: 5 }]),
    ),
  );
  render(<CommercialRulesScreen initialTab="limits" />);
  expect((await screen.findAllByText('VALID_PROFILE')).length).toBeGreaterThan(0);
  expect(await screen.findByText(/Limit rules returned an invalid page/)).toBeTruthy();
  fireEvent.click(screen.getByText('View details'));
  expect(screen.queryByText('PRIVATE')).toBeNull();
  expect(screen.queryByText('unrecognized')).toBeNull();
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(url.includes('limit-profiles') ? page([profile]) : page([rule, rule])),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Limit rules' }));
  expect(await screen.findByText(/Limit rules returned an invalid page/)).toBeTruthy();
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(url.includes('limit-profiles') ? page([profile]) : page([rule])),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Limit rules' }));
  expect((await screen.findAllByText('10000000000000001')).length).toBeGreaterThan(0);
});

test('limit profile invalid fields do not present a misleading empty registry', async () => {
  session(['limit.view']);
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('limit-profiles')
        ? page([
            {
              code: 'BAD_PROFILE',
              name: 'Bad',
              kind: 'AGENT',
              status: 'ACTIVE',
              enabled: 'true',
              configurationStatus: 'CONFIGURED',
              version: 1,
            },
          ])
        : page([]),
    ),
  );
  render(<CommercialRulesScreen initialTab="limits" />);
  expect(await screen.findByText(/Limit profiles returned an invalid page/)).toBeTruthy();
  expect(screen.queryByText(/No limit profiles were returned/)).toBeNull();
});

test('registry refresh accessible name matches the visible loading label', async () => {
  session(['limit.view']);
  const profiles = deferred<unknown>();
  const rules = deferred<unknown>();
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    url.includes('limit-profiles') ? profiles.promise : rules.promise,
  );
  render(<CommercialRulesScreen initialTab="limits" />);
  const loadingProfiles = screen.getByRole('button', {
    name: 'Loading Limit profiles',
  }) as HTMLButtonElement;
  const loadingRules = screen.getByRole('button', {
    name: 'Loading Limit rules',
  }) as HTMLButtonElement;
  expect(loadingProfiles.textContent).toBe('Loading…');
  expect(loadingProfiles.disabled).toBe(true);
  expect(loadingRules.textContent).toBe('Loading…');
  expect(loadingRules.disabled).toBe(true);
  await act(async () => {
    profiles.resolve(page([]));
    rules.resolve(page([]));
    await Promise.all([profiles.promise, rules.promise]);
  });
  expect(screen.getByRole('button', { name: 'Refresh Limit profiles' }).textContent).toBe(
    'Refresh',
  );
  expect(screen.getByRole('button', { name: 'Refresh Limit rules' }).textContent).toBe('Refresh');
});

test('record details open in a read-only drawer and Escape restores focus without mutation', async () => {
  session(['fee_rule.view']);
  (ApiClient.get as jest.Mock).mockResolvedValue(
    page([
      {
        id: 'fee-one',
        productCode: 'TRANSFER',
        currency: 'NGN',
        flatFeeMinor: '100',
        isActive: true,
        minimumFeeMinor: '97',
      },
    ]),
  );
  render(<CommercialRulesScreen initialTab="fees" />);
  const trigger = await screen.findByRole('button', { name: 'View details' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Fees record details' });
  expect(dialog.textContent).toContain('97');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Fees record details' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('catalogue filters reset pagination, persist to later pages and clear without a mutation', async () => {
  session(['fee_rule.view']);
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
    const params = new URLSearchParams(url.split('?')[1]);
    return Promise.resolve(
      page(
        [{ id: params.has('isActive') ? 'filtered-fee' : 'any-fee' }],
        Number(params.get('page')),
        21,
      ),
    );
  });
  render(<CommercialRulesScreen initialTab="fees" />);
  await screen.findByText('any-fee');
  fireEvent.click(screen.getByRole('button', { name: 'Next Fees page' }));
  await screen.findByText('21 total records · Page 2 of 2');
  fireEvent.change(screen.getByLabelText('Fees product code'), { target: { value: 'TRANSFER' } });
  fireEvent.change(screen.getByLabelText('Fees currency'), { target: { value: 'NGN' } });
  fireEvent.change(screen.getByLabelText('Fees active flag'), { target: { value: 'false' } });
  expect(ApiClient.get).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Apply Fees filters' }));
  await screen.findByText('filtered-fee');
  expect(ApiClient.get).toHaveBeenLastCalledWith(
    '/internal/fee-rules?page=1&limit=20&productCode=TRANSFER&currency=NGN&isActive=false',
  );
  expect(
    screen.getByText('Applied: Product code: TRANSFER · Currency: NGN · Active flag: No'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next Fees page' }));
  await screen.findByText('21 total records · Page 2 of 2');
  expect(ApiClient.get).toHaveBeenLastCalledWith(
    '/internal/fee-rules?page=2&limit=20&productCode=TRANSFER&currency=NGN&isActive=false',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear Fees filters' }));
  await screen.findByText('any-fee');
  expect(ApiClient.get).toHaveBeenLastCalledWith('/internal/fee-rules?page=1&limit=20');
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test.each([
  [
    'products',
    'product.view',
    'Products',
    'configuration status',
    'NOT_CONFIGURED',
    'products',
    'configurationStatus',
  ],
  [
    'commissions',
    'commission_rule.view',
    'Commissions',
    'recipient type',
    'AGGREGATOR',
    'commission-rules',
    'recipientType',
  ],
  [
    'rewards',
    'reward_rule.view',
    'Rewards',
    'beneficiary type',
    'CUSTOMER',
    'reward-rules',
    'beneficiaryType',
  ],
  ['limits', 'limit.view', 'Limit profiles', 'profile kind', 'AGENT', 'limit-profiles', 'kind'],
  ['limits', 'limit.view', 'Limit rules', 'dimension', 'DAILY_COUNT', 'limit-rules', 'dimension'],
  [
    'assignments',
    'limit.view',
    'Limit assignments',
    'subject type',
    'AGENT_CLASS',
    'limit-assignments',
    'subjectType',
  ],
] as const)(
  '%s uses the baseline filter for %s / %s',
  async (tab, scope, title, label, value, route, param) => {
    session([scope]);
    (ApiClient.get as jest.Mock).mockResolvedValue(page([]));
    render(<CommercialRulesScreen initialTab={tab} />);
    await screen.findByRole('button', { name: `Refresh ${title}` });
    fireEvent.change(screen.getByLabelText(`${title} ${label}`), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: `Apply ${title} filters` }));
    await screen.findByText('No records match the applied catalogue filters.');
    expect(ApiClient.get).toHaveBeenLastCalledWith(
      `/internal/${route}?page=1&limit=20&${param}=${value}`,
    );
  },
);

const assignment = {
  id: 'd9f831b1-3166-4e9c-b812-955fc6b0818e',
  limitProfileCode: 'AGENT_STANDARD',
  subjectType: 'AGENT_CLASS',
  subjectId: 'd9f831b1-3166-4e9c-b812-955fc6b0818f',
  segmentCode: null,
  precedence: 10,
  version: 1,
  isActive: false,
  effectiveFrom: '2026-11-20T12:00:00.000Z',
  effectiveTo: null,
  unexpected: { confidential: 'Do not show' },
};

test('assignments show subject, profile, precedence and UTC window without implying activation', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(assignment.effectiveFrom));
  try {
    session(['limit.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue(
      page([
        assignment,
        {
          ...assignment,
          id: 'd9f831b1-3166-4e9c-b812-955fc6b08190',
          subjectType: 'GLOBAL',
          subjectId: null,
          effectiveFrom: '2026-01-01T00:00:00Z',
          effectiveTo: assignment.effectiveFrom,
          isActive: true,
        },
      ]),
    );
    render(<CommercialRulesScreen initialTab="assignments" />);
    expect(await screen.findByText(assignment.subjectId)).toBeTruthy();
    expect(screen.getAllByRole('cell', { name: 'AGENT_STANDARD' })).toHaveLength(2);
    expect(screen.getByText(/latest effective start, then the latest creation time/)).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'In window' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Ended' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Open-ended' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'No' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Limit assignments effective window on this page'), {
      target: { value: 'In window' },
    });
    expect(screen.queryByRole('cell', { name: 'GLOBAL' })).toBeNull();
    expect(
      screen.getByText('2 total records · Page 1 of 1 · 1 matching on this page'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    const detail = screen.getByRole('dialog', { name: 'Limit assignments record details' });
    expect(detail.textContent).toContain(assignment.effectiveFrom);
    expect(detail.textContent).not.toContain('Do not show');
    expect(ApiClient.get).toHaveBeenCalledTimes(1);
    expect(ApiClient.post).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});

test('assignment read requires limit.view, ignores late responses on scope loss and distinguishes API denial', async () => {
  session(['limit.modify']);
  const late = deferred<unknown>();
  (ApiClient.get as jest.Mock).mockReturnValue(late.promise);
  render(<CommercialRulesScreen initialTab="assignments" />);
  expect(screen.getByRole('alert').textContent).toContain('limit.view');
  expect(ApiClient.get).not.toHaveBeenCalled();
  act(() => session(['limit.view']));
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments?page=1&limit=20');
  act(() => session(['limit.modify'], 'new-session'));
  await act(async () => {
    late.resolve(page([assignment]));
    await late.promise;
  });
  expect(screen.queryByText(assignment.subjectId)).toBeNull();
  (ApiClient.get as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Forbidden'), { status: 403 }),
  );
  act(() => session(['limit.view'], 'new-session'));
  expect(await screen.findByText(/Access denied by the API for limit assignments/)).toBeTruthy();
  expect(screen.queryByText(/No limit assignments were returned/)).toBeNull();
});

test('reward configuration exposes documented targeting and tier fields, not raw extras or a derived winner', async () => {
  session(['reward_rule.view']);
  (ApiClient.get as jest.Mock).mockResolvedValue(
    page([
      {
        id: 'reward-one',
        productCode: 'TRANSFER',
        currency: 'NGN',
        beneficiaryType: 'CUSTOMER',
        calculationBasis: 'FEE',
        calculationModel: 'TIERED',
        priority: 5,
        campaignCode: 'CAMPAIGN_X',
        effectiveFrom: '2090-01-01T00:00:00Z',
        effectiveTo: null,
        isActive: true,
        tiers: [{ upToMinor: '900719925474099301', bps: 25, unrelated: 'hidden tier value' }],
        unrelated: 'hidden row value',
      },
    ]),
  );
  render(<CommercialRulesScreen initialTab="rewards" />);
  expect(await screen.findByText('Campaign: CAMPAIGN_X')).toBeTruthy();
  expect(screen.getByRole('cell', { name: 'Scheduled' })).toBeTruthy();
  expect(screen.getByText(/Equal highest priorities are ambiguous/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));
  const dialog = screen.getByRole('dialog', { name: 'Rewards record details' });
  expect(dialog.textContent).toContain('900719925474099301');
  expect(dialog.textContent).not.toContain('hidden tier value');
  expect(dialog.textContent).not.toContain('hidden row value');
});
