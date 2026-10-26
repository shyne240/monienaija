import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { ApprovalsScreen } from '../src/screens/authenticated/ApprovalsScreen';
import { SupportTicketsScreen } from '../src/screens/authenticated/SupportTicketsScreen';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

function setPrincipal(roles: string[], scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: roles.includes('FINANCE_CONTROLLER') ? 'PRIVILEGED' : 'OPERATOR',
      principalId: `issuer:${roles[0] ?? 'test'}`,
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

const ticket = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'OPEN',
  priority: 'MEDIUM',
  subject: 'Cash-in receipt question',
  customerId: '22222222-2222-4222-8222-222222222222',
  agentId: null,
  assignedTo: null,
  createdAt: '2026-10-23T10:00:00.000Z',
  updatedAt: '2026-10-23T10:00:00.000Z',
  version: 4,
};

const messages = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    ticketId: ticket.id,
    authorType: 'CUSTOMER',
    authorId: 'customer-1',
    body: 'Customer said the receipt is missing.',
    isInternal: false,
    createdAt: '2026-10-23T10:01:00.000Z',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    ticketId: ticket.id,
    authorType: 'SUPPORT',
    authorId: 'support-1',
    body: 'Internal note for staff.',
    isInternal: true,
    createdAt: '2026-10-23T10:02:00.000Z',
  },
];

describe('Admin Web batch 02: existing support and approval actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    (ApiClient.post as jest.Mock).mockResolvedValue({});
  });

  test('support ticket detail loads message history, labels internal content, and uses existing assign/message routes', async () => {
    setPrincipal(['SUPPORT'], ['customer.manage_support_case']);
    const updatedTicket = { ...ticket, assignedTo: 'issuer:support-operator', version: 5 };
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/internal/support/tickets?')) {
        return Promise.resolve({ items: [ticket], pagination: { page: 1, limit: 20, total: 25, totalPages: 2, hasNextPage: true } });
      }
      if (path === `/internal/support/tickets/${ticket.id}`) return Promise.resolve(ticket);
      if (path === `/internal/support/tickets/${ticket.id}/messages`) return Promise.resolve(messages);
      return Promise.resolve([]);
    });
    (ApiClient.post as jest.Mock).mockImplementation((path: string) => path.endsWith('/assign')
      ? Promise.resolve(updatedTicket)
      : Promise.resolve({ id: 'message-2' }));

    const view = render(<SupportTicketsScreen />);
    expect(await view.findByText('Total 25 — Page 1 of 2')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/support/tickets?page=1&limit=20');

    fireEvent.click(view.getByRole('button', { name: 'View' }));
    expect(await view.findByText('Customer said the receipt is missing.')).toBeTruthy();
    expect(await view.findByText('Internal note for staff.')).toBeTruthy();
    expect(view.getByText('Internal')).toBeTruthy();
    expect(view.getByText('Customer-visible')).toBeTruthy();

    fireEvent.change(view.getByPlaceholderText('Assignee principal ID'), { target: { value: 'issuer:support-operator' } });
    fireEvent.click(view.getByRole('button', { name: 'Assign Ticket' }));
    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(`/internal/support/tickets/${ticket.id}/assign`, {
        assignedTo: 'issuer:support-operator',
        version: 4,
      });
    });

    fireEvent.change(view.getByPlaceholderText('Add customer-visible message…'), { target: { value: 'We are checking the transaction.' } });
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(`/internal/support/tickets/${ticket.id}/messages`, {
        body: 'We are checking the transaction.',
        isInternal: false,
      });
      expect(view.getByText('Customer-visible message added.')).toBeTruthy();
    });
  });

  test('support controls remain unavailable without customer.manage_support_case', async () => {
    setPrincipal(['SUPPORT'], []);
    render(<SupportTicketsScreen />);
    expect(await waitFor(() => document.body.textContent?.includes('customer.manage_support_case'))).toBe(true);
    expect(ApiClient.get).not.toHaveBeenCalled();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('generic checker UI invokes existing approve and reject routes with the optional audit comment', async () => {
    setPrincipal(['FINANCE_CONTROLLER'], ['privileged:approve']);
    const view = render(<ApprovalsScreen />);
    fireEvent.change(view.getByPlaceholderText('e.g. 5e6f7g8h-1234-...'), { target: { value: 'approval-reject-1' } });
    fireEvent.change(view.getByPlaceholderText('Provide context or explanation for auditing...'), { target: { value: 'Not approved: evidence is incomplete.' } });
    fireEvent.click(view.getByRole('button', { name: 'Reject Action' }));
    expect(await view.findByText('Approval decision recorded as rejected successfully.')).toBeTruthy();
    expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/approvals/approval-reject-1/reject', {
      comment: 'Not approved: evidence is incomplete.',
    });

    fireEvent.change(view.getByPlaceholderText('e.g. 5e6f7g8h-1234-...'), { target: { value: 'approval-approve-2' } });
    fireEvent.click(view.getByRole('button', { name: 'Sign & Approve Action' }));
    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/approvals/approval-approve-2/approve', {
        comment: undefined,
      });
    });
  });

  test('approvals screen requires the configured checker role and scope', () => {
    setPrincipal(['FINANCE_CONTROLLER'], []);
    render(<ApprovalsScreen />);
    expect(document.body.textContent).toContain('privileged:approve');
    expect(ApiClient.post).not.toHaveBeenCalled();
  });
});
