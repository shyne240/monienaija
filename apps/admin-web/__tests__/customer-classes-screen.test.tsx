import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerClassesScreen } from '../src/screens/authenticated/CustomerClassesScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
const record = {
  id: 'id-1',
  code: 'STANDARD',
  name: 'Standard',
  status: 'ACTIVE',
  enabled: true,
  configurationStatus: 'CONFIGURED',
  isDefault: true,
  version: 7,
};
function principal(scopes: string[], readOnlyPrincipal = false) {
  useAuthStore.setState({
    principal: {
      type: 'OPERATOR',
      principalId: 'operator',
      sessionId: 'session',
      audience: 'workforce-admin',
      roles: [],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
      readOnlyPrincipal,
    },
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  (ApiClient.get as jest.Mock).mockResolvedValue([record]);
});

test('read-only principal can see classes but cannot edit them', async () => {
  principal(['customer.view', 'customer.manage_classes'], true);
  render(<CustomerClassesScreen />);
  expect(await screen.findByText(/Standard \(STANDARD\)/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
});

test('manager changes a name with optimistic version evidence', async () => {
  principal(['customer.view', 'customer.manage_classes']);
  (ApiClient.patch as jest.Mock).mockResolvedValue({});
  render(<CustomerClassesScreen />);
  const input = await screen.findByLabelText('Edit name for STANDARD');
  fireEvent.change(input, { target: { value: 'Everyday' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() =>
    expect(ApiClient.patch).toHaveBeenCalledWith('/internal/customer-classes/id-1', {
      name: 'Everyday',
      expectedVersion: 7,
    }),
  );
});

test('inspects class limits and assigns a segment limit profile to a customer class', async () => {
  principal([
    'customer.view',
    'customer.manage_classes',
    'limit.view',
    'limit.modify',
    'fee_rule.view',
  ]);
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path === '/internal/customer-classes') return Promise.resolve([record]);
    if (path === '/internal/limit-assignments/segment/STANDARD')
      return Promise.resolve([
        {
          id: 'assign-1',
          limitProfileCode: 'CUSTOMER_STANDARD',
          subjectType: 'SEGMENT',
          segmentCode: 'STANDARD',
          precedence: 5,
          isActive: true,
        },
      ]);
    if (path.startsWith('/internal/fee-rules'))
      return Promise.resolve({
        data: [
          {
            id: 'fee-std',
            productCode: 'WALLET_TRANSFER',
            currency: 'NGN',
            customerClassCode: 'STANDARD',
            isActive: true,
            priority: 10,
          },
        ],
      });
    return Promise.resolve([]);
  });
  (ApiClient.post as jest.Mock).mockResolvedValue({});

  render(<CustomerClassesScreen />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Inspect limits & policy for STANDARD' }),
  );
  expect(await screen.findByText('CUSTOMER_STANDARD')).toBeTruthy();
  expect(await screen.findByText('WALLET_TRANSFER')).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Limit profile for STANDARD'), {
    target: { value: 'customer_vip' },
  });
  fireEvent.change(screen.getByLabelText('Precedence for STANDARD'), {
    target: { value: '15' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Assign class limit profile' }));

  await waitFor(() =>
    expect(ApiClient.post).toHaveBeenCalledWith('/internal/limit-assignments', {
      subjectType: 'SEGMENT',
      segmentCode: 'STANDARD',
      limitProfileCode: 'CUSTOMER_VIP',
      precedence: 15,
    }),
  );
});

test('enforces independent checker UI for tier default proposals and executes approved proposals', async () => {
  const tierDefaultsPayload = {
    mappings: [
      {
        tier: 'LEVEL_1',
        classId: 'id-1',
        classCode: 'STANDARD',
        className: 'Standard',
        status: 'PENDING_APPROVAL',
        approvedAt: null,
        approvedBy: null,
        approvalId: null,
        reason: 'Seeded',
        globalDefaultClassCodeAtMigration: 'STANDARD',
        classUsable: true,
        version: 1,
      },
      {
        tier: 'LEVEL_2',
        classId: 'id-1',
        classCode: 'STANDARD',
        className: 'Standard',
        status: 'PENDING_APPROVAL',
        approvedAt: null,
        approvedBy: null,
        approvalId: null,
        reason: 'Seeded',
        globalDefaultClassCodeAtMigration: 'STANDARD',
        classUsable: true,
        version: 1,
      },
      {
        tier: 'LEVEL_3',
        classId: 'id-1',
        classCode: 'STANDARD',
        className: 'Standard',
        status: 'PENDING_APPROVAL',
        approvedAt: null,
        approvedBy: null,
        approvalId: null,
        reason: 'Seeded',
        globalDefaultClassCodeAtMigration: 'STANDARD',
        classUsable: true,
        version: 1,
      },
    ],
    globalDefault: { classId: 'id-1', classCode: 'STANDARD', className: 'Standard' },
    allApproved: false,
    pendingApprovalCount: 3,
  };

  principal(['customer.view', 'customer.manage_classes']);
  let proposalStatus = 'REQUESTED';
  let requester = 'operator';
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path === '/internal/customer-classes') return Promise.resolve([record]);
    if (path === '/internal/customer-classes/tier-defaults')
      return Promise.resolve(tierDefaultsPayload);
    if (path.startsWith('/internal/a2/workforce/approvals'))
      return Promise.resolve({
        items: [
          {
            id: 'app-1',
            status: proposalStatus,
            requesterPrincipalId: requester,
            approvedBy: proposalStatus === 'APPROVED' ? 'checker' : null,
            reason: 'Initial tier mapping approval',
            policy: {
              requestDetails: {
                tierDefaults: { LEVEL_1: 'id-1', LEVEL_2: 'id-1', LEVEL_3: 'id-1' },
                reason: 'Initial tier mapping approval',
              },
            },
          },
        ],
        total: 1,
      });
    return Promise.resolve([]);
  });

  const { unmount } = render(<CustomerClassesScreen />);
  expect(await screen.findByText('Independent checker required')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Approve proposal' })).toBeNull();
  unmount();

  requester = 'maker-principal';
  (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
    if (path === '/internal/a2/workforce/approvals/app-1/approve') {
      proposalStatus = 'APPROVED';
      return Promise.resolve({ approved: true });
    }
    return Promise.resolve({});
  });

  render(<CustomerClassesScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Approve proposal' }));
  await waitFor(() =>
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/a2/workforce/approvals/app-1/approve',
      { comment: 'Approved via Tier Default Service Classes' },
    ),
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Apply approved proposal' }));
  await waitFor(() =>
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/customer-classes/tier-defaults/proposals/app-1/execute',
      {
        tierDefaults: { LEVEL_1: 'id-1', LEVEL_2: 'id-1', LEVEL_3: 'id-1' },
        reason: 'Initial tier mapping approval',
      },
    ),
  );
});
