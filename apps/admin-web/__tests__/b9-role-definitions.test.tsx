import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoleDefinitionsPanel } from '../src/components/RoleDefinitionsPanel';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const FUNCTIONS = [
  {
    functionCode: 'fee_rule.view',
    name: 'View fee rules',
    domain: 'commercial',
    sensitivity: 'READ',
    v1Status: 'IMPLEMENTED',
    financeClassRestricted: false,
  },
  {
    functionCode: 'audit.search',
    name: 'Search audit events',
    domain: 'audit',
    sensitivity: 'READ',
    v1Status: 'IMPLEMENTED',
    financeClassRestricted: false,
  },
];

const proposal = (overrides: Record<string, unknown> = {}) => ({
  id: 'p-1',
  proposalType: 'CREATE',
  targetRoleKey: 'SOC_ANALYST',
  proposedDisplayName: 'SOC Analyst',
  proposedDescription: 'Read-only commercial and audit visibility.',
  proposedReadOnly: true,
  proposedFunctionGrants: [{ functionCode: 'fee_rule.view', accessType: 'VIEW' }],
  deactivate: false,
  status: 'REQUESTED',
  approvalId: 'a-1',
  appliedRoleId: null,
  reason: 'Need read-only visibility',
  decisionReason: null,
  requestedAt: '2026-11-25T09:00:00.000Z',
  expiresAt: '2026-11-25T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => jest.resetAllMocks());

test('nothing is requested until the workspace is opened', () => {
  render(<RoleDefinitionsPanel canDefine canDecide canApply />);
  expect(ApiClient.get).not.toHaveBeenCalled();
  expect(screen.getByTestId('rd-closed')).toBeTruthy();
});

test('the function catalogue and definitions load on open, with an empty state', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(url.includes('/functions') ? FUNCTIONS : []),
  );
  render(<RoleDefinitionsPanel canDefine canDecide canApply />);
  fireEvent.click(screen.getByTestId('rd-open'));
  await waitFor(() => expect(screen.getByTestId('rd-function-fee_rule.view')).toBeTruthy());
  expect(screen.getByText(/No role definition has been proposed yet/)).toBeTruthy();
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/a2/workforce/role-definitions/functions');
});

test('a definition submits the selected catalogue functions and states why it cannot act yet', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(url.includes('/functions') ? FUNCTIONS : []),
  );
  (ApiClient.post as jest.Mock).mockResolvedValue({ success: true, proposal: proposal() });
  render(<RoleDefinitionsPanel canDefine canDecide canApply />);
  fireEvent.click(screen.getByTestId('rd-open'));
  await waitFor(() => expect(screen.getByTestId('rd-function-audit.search')).toBeTruthy());

  fireEvent.change(screen.getByLabelText('Role key'), { target: { value: 'soc_analyst' } });
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'SOC Analyst' } });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Read-only commercial and audit visibility.' },
  });
  fireEvent.click(screen.getByTestId('rd-function-fee_rule.view'));
  fireEvent.click(screen.getByTestId('rd-function-audit.search'));
  fireEvent.change(screen.getByLabelText('Reason for the definition'), {
    target: { value: 'Need read-only visibility' },
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('rd-submit'));
  });

  expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/role-definitions/proposals', {
    proposalType: 'CREATE',
    roleKey: 'SOC_ANALYST',
    displayName: 'SOC Analyst',
    description: 'Read-only commercial and audit visibility.',
    readOnly: true,
    functionGrants: [
      { functionCode: 'fee_rule.view', accessType: 'VIEW' },
      { functionCode: 'audit.search', accessType: 'VIEW' },
    ],
    reason: 'Need read-only visibility',
  });
  expect(screen.getByRole('status').textContent).toContain('independent checker');
});

test('a checker decides a pending definition and a SUPER_ADMIN applies the approved one', async () => {
  let proposals = [proposal()];
  (ApiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(url.includes('/functions') ? FUNCTIONS : proposals),
  );
  (ApiClient.post as jest.Mock).mockImplementation((url: string) => {
    if (url.endsWith('/approve')) {
      proposals = [proposal({ status: 'APPROVED' })];
      return Promise.resolve({ success: true, proposal: proposals[0] });
    }
    proposals = [proposal({ status: 'APPLIED', appliedRoleId: 'role-1' })];
    return Promise.resolve({ success: true, proposal: proposals[0] });
  });
  render(<RoleDefinitionsPanel canDefine canDecide canApply />);
  fireEvent.click(screen.getByTestId('rd-open'));
  await waitFor(() => expect(screen.getByTestId('rd-proposal-p-1')).toBeTruthy());
  expect(screen.getByTestId('rd-proposal-p-1').textContent).toContain(
    'Awaiting independent approval',
  );

  await act(async () => {
    fireEvent.click(screen.getByTestId('rd-approve-p-1'));
  });
  expect(ApiClient.post).toHaveBeenCalledWith(
    '/internal/a2/workforce/role-definitions/proposals/p-1/approve',
    expect.objectContaining({ comment: expect.any(String) }),
  );
  await waitFor(() =>
    expect(screen.getByTestId('rd-proposal-p-1').textContent).toContain(
      'Approved — not yet applied',
    ),
  );

  await act(async () => {
    fireEvent.click(screen.getByTestId('rd-apply-p-1'));
  });
  expect(ApiClient.post).toHaveBeenCalledWith(
    '/internal/a2/workforce/role-definitions/proposals/p-1/apply',
  );
  await waitFor(() =>
    expect(screen.getByTestId('rd-proposal-p-1').textContent).toContain('Applied to the catalogue'),
  );
});

test('a rejected catalogue read is stated, not hidden behind an empty list', async () => {
  (ApiClient.get as jest.Mock).mockRejectedValue({ status: 403 });
  render(<RoleDefinitionsPanel canDefine={false} canDecide={false} canApply={false} />);
  fireEvent.click(screen.getByTestId('rd-open'));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'your role does not hold the required authorization function',
    ),
  );
  expect(screen.getByTestId('rd-no-authoring')).toBeTruthy();
});
