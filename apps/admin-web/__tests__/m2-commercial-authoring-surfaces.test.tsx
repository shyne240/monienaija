import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CommercialAuthoringDrawer } from '../src/screens/authenticated/CommercialAuthoringDrawer';
import { CommercialPreviewPanel } from '../src/screens/authenticated/CommercialPreviewPanel';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

function session(scopes: string[], readOnlyPrincipal = false) {
  useAuthStore.setState({
    isAuthenticated: true,
    token: 'authoring',
    sessionId: 'authoring',
    principal: {
      type: 'OPERATOR',
      principalId: 'synthetic',
      sessionId: 'authoring',
      audience: 'workforce-admin',
      roles: ['FINANCE_PREPARER'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
      readOnlyPrincipal,
    } as never,
  });
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    previewedAt: '2026-03-01T12:00:00.000Z',
    authoritative: 'BACKEND_RESOLVERS',
    mode: 'ADVISORY',
    disclaimer: 'Advisory only: running it moves no money.',
    request: {
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      principalType: 'CUSTOMER',
      principalId: null,
      agentClassId: null,
      segmentCodes: [],
      institutionId: null,
      direction: 'OUTGOING',
      channel: null,
      amountMinor: '250000',
      serviceClass: null,
      evaluatedAt: '2026-03-01T12:00:00.000Z',
    },
    product: {
      code: 'WALLET_TRANSFER',
      name: 'Wallet transfer',
      domain: 'WALLET',
      currency: 'NGN',
      productScope: 'CUSTOMER',
      status: 'ACTIVE',
      enabled: true,
      configurationStatus: 'CONFIGURED',
      version: 3,
    },
    institution: null,
    customerClass: {
      status: 'NOT_APPLICABLE',
      note: 'No customer-class resolution contract is published on this integration baseline, so no class was inferred.',
    },
    kycRestriction: {
      kycLevel: 'LEVEL_2',
      tierEnforcementActivationEnabled: false,
      tierMapping: null,
      note: 'Tier limit enforcement is inactive for this environment.',
    },
    limits: {
      status: 'MISSING',
      note: 'The assigned profile holds no rule matching this product.',
      assignment: null,
      governingProfileCodes: ['STANDARD'],
      assignmentProfileCode: null,
      tierProfileCode: null,
      rules: [],
      evaluatedDimensions: [],
      tierEnforcementInactive: true,
    },
    fee: {
      status: 'AMBIGUOUS',
      note: 'Two rules share the top priority; none was selected.',
      currency: 'NGN',
      evaluatedAt: '2026-03-01T12:00:00.000Z',
      rule: null,
      ambiguousRuleIds: ['fee-a', 'fee-b'],
      ambiguousPriority: 40,
      computed: null,
    },
    commission: {
      status: 'NOT_APPLICABLE',
      note: 'No amount supplied.',
      allocations: [],
      accrualPosted: false,
    },
    reward: {
      status: 'NOT_APPLICABLE',
      note: 'No reward rule applies.',
      grants: [],
      creditPosted: false,
    },
    explanation: [
      {
        code: 'LIMIT_RULE_MISSING',
        message: 'No applicable limit rule exists for this dimension.',
        severity: 'BLOCKER',
      },
      {
        code: 'TIER_ENFORCEMENT_INACTIVE',
        message: 'Tier enforcement is disabled for this deployment.',
        severity: 'WARNING',
      },
    ],
    summary: {
      sections: {
        limits: 'MISSING',
        fee: 'AMBIGUOUS',
        commission: 'NOT_APPLICABLE',
        reward: 'NOT_APPLICABLE',
      },
      blockerCount: 2,
      warningCount: 1,
    },
    guarantees: { readonly: true, writesPerformed: [], financialMutations: [] },
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('effective-configuration preview panel', () => {
  test('renders every backend status verbatim, including MISSING and AMBIGUOUS', async () => {
    session(['limit.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue(preview());

    render(<CommercialPreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(await screen.findByText(/Two rules share the top priority/)).toBeTruthy();
    expect(screen.getAllByText('MISSING').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AMBIGUOUS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('NOT_APPLICABLE').length).toBeGreaterThan(0);
    // The conflicting rules are listed; the panel does not pick a winner.
    expect(screen.getByText('fee-a, fee-b')).toBeTruthy();
  });

  test('states the advisory boundary and that nothing was written', async () => {
    session(['limit.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue(preview());

    render(<CommercialPreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(await screen.findByText(/Advisory preview/i)).toBeTruthy();
    expect(screen.getByText(/running it moves no money/i)).toBeTruthy();
    expect(screen.getByText(/No money moved: 0 writes/i)).toBeTruthy();
    expect(screen.getByText('LIMIT_RULE_MISSING')).toBeTruthy();
    expect(screen.getByText('TIER_ENFORCEMENT_INACTIVE')).toBeTruthy();
  });

  test('renders the customer-class gap as not applicable rather than inferring a class', async () => {
    session(['limit.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue(preview());

    render(<CommercialPreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(await screen.findByText(/no class was inferred/)).toBeTruthy();
  });

  test('refuses to render a response that drops the read-only guarantee', async () => {
    session(['limit.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue({
      ...preview(),
      guarantees: { readonly: true, writesPerformed: ['limit_usage'], financialMutations: [] },
    });

    render(<CommercialPreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(
      await screen.findByText(/did not carry the backend read-only guarantee/),
    ).toBeTruthy();
    expect(screen.queryByText(/Advisory preview/i)).toBeNull();
  });

  test('a 403 from the API is surfaced instead of rendering an empty preview', async () => {
    session(['limit.view']);
    (ApiClient.get as jest.Mock).mockRejectedValue({ status: 403, message: 'Forbidden' });

    render(<CommercialPreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(await screen.findByText(/denied this preview for your session/i)).toBeTruthy();
  });

  test('a session without limit.view is told why, and no request is made', () => {
    session(['fee_rule.view']);

    render(<CommercialPreviewPanel />);

    expect(screen.getByText(/requires the/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /evaluate configuration/i })).toBeNull();
    expect(ApiClient.get).not.toHaveBeenCalled();
  });
});

describe('governed authoring drawer', () => {
  test('fee creation submits a proposal and never claims the rule exists', async () => {
    session(['fee_rule.create']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });
    (ApiClient.post as jest.Mock).mockResolvedValue({
      approvalId: 'approval-1',
      status: 'REQUESTED',
      actionType: 'FEE_RULE_CREATE',
      resourceType: 'FEE_RULE',
      resourceId: null,
    });
    const onRequested = jest.fn();

    render(
      <CommercialAuthoringDrawer
        domain="fees"
        mode="create"
        onClose={jest.fn()}
        onRequested={onRequested}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Product code/), {
      target: { value: 'wallet_transfer' },
    });
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'NGN' } });
    fireEvent.change(screen.getByLabelText(/Effective from/), {
      target: { value: '2026-03-01T00:00' },
    });
    fireEvent.change(screen.getByLabelText(/Reason for this change/), {
      target: { value: 'Add the standard transfer fee' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    const [path, body] = (ApiClient.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/internal/fee-rules');
    expect(body).toMatchObject({
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      reason: 'Add the standard transfer fee',
    });
    expect(body.effectiveFrom).toBe('2026-03-01T00:00:00.000Z');

    expect(await screen.findByText(/Proposal recorded/i)).toBeTruthy();
    expect(screen.getByText('approval-1')).toBeTruthy();
    expect(screen.getByText(/Waiting for an independent FINANCE_CONTROLLER/)).toBeTruthy();
    expect(onRequested).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'approval-1', status: 'REQUESTED' }),
    );
  });

  test('limit rule creation posts to the profile-scoped governed path', async () => {
    session(['limit.modify']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });
    (ApiClient.post as jest.Mock).mockResolvedValue({
      approvalId: 'approval-limit',
      status: 'REQUESTED',
      actionType: 'LIMIT_RULE_CREATE',
      resourceType: 'LIMIT_RULE',
      resourceId: null,
    });

    render(
      <CommercialAuthoringDrawer
        domain="limits"
        mode="create"
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Limit profile code/), {
      target: { value: 'standard' },
    });
    fireEvent.change(screen.getByLabelText(/^Product/), { target: { value: 'TRANSFER' } });
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'NGN' } });
    fireEvent.change(screen.getByLabelText(/Dimension/), { target: { value: 'DAILY_AMOUNT' } });
    fireEvent.change(screen.getByLabelText(/Amount limit/), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText(/Effective from/), {
      target: { value: '2026-03-01T00:00' },
    });
    fireEvent.change(screen.getByLabelText(/Reason for this change/), {
      target: { value: 'Daily cap for transfers' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    const [path, body] = (ApiClient.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/internal/limit-profiles/STANDARD/rules');
    expect(body).toMatchObject({
      product: 'TRANSFER',
      currency: 'NGN',
      dimension: 'DAILY_AMOUNT',
      limitValueMinor: '500000',
    });
    // The profile code is in the path, not the body.
    expect('limitProfileCode' in body).toBe(false);
    expect(await screen.findByText(/Proposal recorded/i)).toBeTruthy();
  });

  test('an incoherent limit dimension is refused before any call', async () => {
    session(['limit.modify']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });

    render(
      <CommercialAuthoringDrawer
        domain="limits"
        mode="create"
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Limit profile code/), { target: { value: 'STANDARD' } });
    fireEvent.change(screen.getByLabelText(/^Product/), { target: { value: 'TRANSFER' } });
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'NGN' } });
    fireEvent.change(screen.getByLabelText(/Dimension/), { target: { value: 'DAILY_COUNT' } });
    fireEvent.change(screen.getByLabelText(/Count limit/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Amount limit/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Effective from/), {
      target: { value: '2026-03-01T00:00' },
    });
    fireEvent.change(screen.getByLabelText(/Reason for this change/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }));

    expect(await screen.findByText(/count dimension and must not carry an amount/)).toBeTruthy();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('the three-phase boundary is explained before anything is typed', () => {
    session(['fee_rule.create']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });

    render(
      <CommercialAuthoringDrawer
        domain="fees"
        mode="create"
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    expect(screen.getByText(/Nothing is written until two people agree/i)).toBeTruthy();
    expect(screen.getByText(/cannot approve their own request/)).toBeTruthy();
    expect(screen.getByText(/No fee is charged/)).toBeTruthy();
  });

  test('a modify form locks identity fields and sends the loaded version', async () => {
    session(['fee_rule.create', 'fee_rule.modify']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });
    (ApiClient.patch as jest.Mock).mockResolvedValue({
      approvalId: 'approval-2',
      status: 'REQUESTED',
      actionType: 'FEE_RULE_MODIFY',
      resourceType: 'FEE_RULE',
      resourceId: 'fee-1',
    });

    render(
      <CommercialAuthoringDrawer
        domain="fees"
        mode="modify"
        record={{
          id: 'fee-1',
          version: 4,
          productCode: 'WALLET_TRANSFER',
          currency: 'NGN',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          maximumFeeMinor: '1000',
          isActive: true,
        }}
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    expect(
      (screen.getByLabelText(/Product code/) as HTMLElement).hasAttribute('disabled'),
    ).toBe(true);
    expect((screen.getByLabelText(/Currency/) as HTMLElement).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText(/Immutable after creation/).length).toBeGreaterThanOrEqual(3);

    fireEvent.change(screen.getByLabelText(/Maximum fee/), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText(/Reason for this change/), {
      target: { value: 'Raise the cap' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => expect(ApiClient.patch).toHaveBeenCalledTimes(1));
    const [path, body] = (ApiClient.patch as jest.Mock).mock.calls[0];
    expect(path).toBe('/internal/fee-rules/fee-1');
    expect(body.version).toBe(4);
    expect(body.maximumFeeMinor).toBe('2000');
    expect('productCode' in body).toBe(false);
    expect('effectiveFrom' in body).toBe(false);
  });

  test('a 403 is rendered verbatim and nothing is retried', async () => {
    session(['fee_rule.create']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });
    (ApiClient.post as jest.Mock).mockRejectedValue({
      status: 403,
      message: 'Function fee_rule.create is not granted',
    });

    render(
      <CommercialAuthoringDrawer
        domain="fees"
        mode="create"
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Product code/), { target: { value: 'TRANSFER' } });
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'NGN' } });
    fireEvent.change(screen.getByLabelText(/Effective from/), {
      target: { value: '2026-03-01T00:00' },
    });
    fireEvent.change(screen.getByLabelText(/Reason for this change/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }));

    expect(await screen.findByText(/Function fee_rule.create is not granted/)).toBeTruthy();
    expect(ApiClient.post).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Proposal recorded/i)).toBeNull();
  });

  test('a session without the maker function is told, and the submit control is inert', () => {
    session(['fee_rule.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });

    render(
      <CommercialAuthoringDrawer
        domain="fees"
        mode="create"
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    expect(screen.getByText(/does not hold fee_rule.create/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /submit for approval/i }) as HTMLElement).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
  });

  test('a session without limit.modify cannot author limit rules', () => {
    session(['limit.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });

    render(
      <CommercialAuthoringDrawer
        domain="limits"
        mode="create"
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    expect(screen.getByText(/does not hold limit.modify/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /submit for approval/i }) as HTMLElement).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
  });

  test('change history shows the recorded lifecycle', async () => {
    session(['fee_rule.create', 'fee_rule.modify']);
    (ApiClient.get as jest.Mock).mockResolvedValue({
      entries: [
        {
          approvalId: 'approval-9',
          actionType: 'FEE_RULE_MODIFY',
          status: 'CONSUMED',
          reason: 'Lower the cap',
          requestedAt: '2026-02-01T10:00:00.000Z',
          approvedAt: '2026-02-01T10:05:00.000Z',
          consumedAt: '2026-02-01T10:06:00.000Z',
          executed: true,
        },
      ],
    });

    render(
      <CommercialAuthoringDrawer
        domain="fees"
        mode="modify"
        record={{ id: 'fee-1', version: 2, currency: 'NGN', isActive: true }}
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    expect(await screen.findByText('Lower the cap')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith(
      expect.stringContaining(
        '/internal/commercial-configuration/change-history?actionType=FEE_RULE_MODIFY&resourceId=fee-1',
      ),
    );
  });

  test('an empty history is described as pre-governance, not as an error', async () => {
    session(['reward_rule.create', 'reward_rule.modify']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ entries: [] });

    render(
      <CommercialAuthoringDrawer
        domain="rewards"
        mode="modify"
        record={{ id: 'reward-1', version: 1, currency: 'NGN', isActive: true }}
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    expect(await screen.findByText(/may predate governance/)).toBeTruthy();
  });

  test('a history 403 is reported rather than silently empty', async () => {
    session(['fee_rule.create', 'fee_rule.modify']);
    (ApiClient.get as jest.Mock).mockRejectedValue({ status: 403, message: 'Forbidden' });

    render(
      <CommercialAuthoringDrawer
        domain="fees"
        mode="modify"
        record={{ id: 'fee-1', version: 2, currency: 'NGN', isActive: true }}
        onClose={jest.fn()}
        onRequested={jest.fn()}
      />,
    );

    expect(await screen.findByText(/denied read access to this change history/)).toBeTruthy();
  });
});
