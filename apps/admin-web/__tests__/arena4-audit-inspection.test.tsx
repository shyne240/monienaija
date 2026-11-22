import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { AuditInspectionScreen } from '../src/screens/authenticated/AuditInspectionScreen';
import { ApiClient, ApiError } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiClient: { get: jest.fn() },
    ApiError: MockApiError,
  };
});

const page = {
  data: [
    {
      id: 'evt-1',
      occurredAt: '2026-11-22T06:00:00Z',
      actor: 'workforce-principal-a',
      action: 'role.assignment.approved',
      entityType: 'AUTHORIZATION_DECISION',
      entityId: 'decision-1',
      outcome: 'ALLOWED',
      institutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
  totalPages: 1,
  accessMode: 'READ_ONLY',
  excludedCategories: ['CUSTOMER_PREFERENCE', 'COMPLIANCE_CASE', 'PROVIDER_SECRET'],
};

const detail = {
  event: {
    id: 'evt-1',
    occurredAt: '2026-11-22T06:00:00Z',
    actor: 'workforce-principal-a',
    action: 'role.assignment.approved',
    entityType: 'AUTHORIZATION_DECISION',
    entityId: 'decision-1',
    outcome: 'ALLOWED',
    institutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    correlationId: null,
  },
  approvalHistory: [
    {
      id: 'approval-1',
      actionType: 'WORKFORCE_ROLE_ASSIGN',
      status: 'APPROVED',
      requesterPrincipalId: 'workforce-principal-a',
      approvedBy: 'workforce-principal-b',
      requestedAt: '2026-11-22T05:59:00Z',
      decidedAt: '2026-11-22T06:00:00Z',
    },
  ],
  relatedEvents: [
    {
      id: 'evt-0',
      occurredAt: '2026-11-22T05:59:00Z',
      actor: 'workforce-principal-a',
      action: 'role.assignment.requested',
      outcome: 'RECORDED',
    },
  ],
  boundaries: { readOnly: true },
};

function session(scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    token: 's',
    sessionId: 's',
    principal: {
      type: 'OPERATOR',
      principalId: 'operator',
      sessionId: 's',
      audience: 'workforce-admin',
      roles: ['FINANCE_AUDITOR'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  session(['audit.view', 'audit.search']);
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/audit/inspection?')) return Promise.resolve(page);
    if (path.startsWith('/internal/audit/inspection/')) return Promise.resolve(detail);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

test('requires both audit.view and audit.search', () => {
  session(['audit.search']);
  render(<AuditInspectionScreen />);
  expect(screen.getByRole('alert').textContent).toContain('audit.view');
  expect(ApiClient.get).not.toHaveBeenCalled();
});

test('renders the server-enforced privacy boundary', async () => {
  render(<AuditInspectionScreen />);
  expect(await screen.findByText('role.assignment.approved')).toBeTruthy();
  expect(screen.getByTestId('a4-audit-privacy-notice').textContent).toContain('provider-secret');
  expect(document.body.textContent).toContain('COMPLIANCE_CASE');
});

test('sends actor, action, resource, outcome, institution and bounded time filters', async () => {
  render(<AuditInspectionScreen />);
  await screen.findByText('role.assignment.approved');

  fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'workforce-principal-a' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'role.assignment' } });
  fireEvent.change(screen.getByLabelText('Resource type'), {
    target: { value: 'authorization_decision' },
  });
  fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'DENIED' } });
  fireEvent.change(screen.getByLabelText('Institution ID'), {
    target: { value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  });
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-21T00:00' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-22T00:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search audit records' }));

  const calls = (ApiClient.get as jest.Mock).mock.calls.map((call) => String(call[0]));
  const search = calls.filter((path) => path.startsWith('/internal/audit/inspection?')).pop() ?? '';
  expect(search).toContain('actor=workforce-principal-a');
  expect(search).toContain('action=role.assignment');
  expect(search).toContain('entityType=AUTHORIZATION_DECISION');
  expect(search).toContain('outcome=DENIED');
  expect(search).toContain('institutionId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(search).toContain('from=2026-11-21T00%3A00%3A00.000Z');
});

test('detail shows approval history and related events', async () => {
  render(<AuditInspectionScreen />);
  await screen.findByText('role.assignment.approved');
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));

  expect(await screen.findByText('Approval history')).toBeTruthy();
  expect(screen.getByText('workforce-principal-b')).toBeTruthy();
  expect(document.body.textContent).toContain('role.assignment.requested');
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/audit/inspection/evt-1');
});

test('an excluded or absent record does not reveal whether it exists', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/audit/inspection?')) return Promise.resolve(page);
    return Promise.reject(new ApiError('Not Found', 404));
  });
  render(<AuditInspectionScreen />);
  await screen.findByText('role.assignment.approved');
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Record not found or excluded from this read surface.');
  expect(screen.queryByText('Approval history')).toBeNull();
});
