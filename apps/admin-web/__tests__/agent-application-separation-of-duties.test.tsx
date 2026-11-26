import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  ApiError: class MockApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

const CLASS_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MINE = 'row-mine';
const THEIRS = 'row-theirs';

/**
 * The separation-of-duties rule is enforced server-side; this asserts the console TELLS the
 * submitting operator why they cannot approve, instead of offering a button that would fail.
 */
function signInAsReviewer() {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'workforce-session-token',
    sessionId: 'session-sod',
    error: null,
    principal: {
      type: 'OPERATOR',
      principalId: 'operator-sod',
      sessionId: 'session-sod',
      roles: ['AGENT_NETWORK_MANAGER'],
      scopes: ['agent.view', 'agent.review_application', 'agent.activate'],
      assuranceLevel: 'MFA',
      audience: 'workforce-admin',
      customerAccess: 'ANY',
    },
  });
}

function applicationRow(id: string, reference: string, selfSubmitted: boolean) {
  return {
    id,
    reference,
    agentClassId: CLASS_ID,
    status: 'SUBMITTED',
    applicantReference: `ACC-${reference}`,
    businessName: 'Kiosk',
    contactEmail: 'kiosk@example.test',
    submittedAt: '2026-11-25T10:00:00.000Z',
    version: 1,
    agentId: null,
    rejectionReason: null,
    createdAt: '2026-11-25T09:00:00.000Z',
    selfSubmitted,
  };
}

function mockApi() {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path === '/internal/agents/applications')
      return Promise.resolve([
        applicationRow(MINE, 'AGENT-APP-MINE', true),
        applicationRow(THEIRS, 'AGENT-APP-THEIRS', false),
      ]);
    if (path === '/internal/agents/classes')
      return Promise.resolve([
        {
          id: CLASS_ID,
          reference: 'CLS-1',
          code: 'DEMO_ORDINARY_L1',
          name: 'Demo Ordinary Agent (Level 1)',
          isActive: true,
          applicableServices: ['CASH_IN'],
        },
      ]);
    if (path.startsWith('/internal/agent-classes/')) return Promise.resolve(null);
    if (path.startsWith('/internal/agents')) return Promise.resolve({ data: [], total: 0 });
    return Promise.resolve({});
  });
}

describe('Agent application separation of duties (Admin Web)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signInAsReviewer();
    mockApi();
  });

  it('explains why the submitter cannot approve, and does not offer the button', async () => {
    const view = render(<AgentNetworkScreen />);
    // The queue is behind an explicit load, exactly as an operator experiences it.
    fireEvent.click(await view.findByRole('button', { name: 'Load applications' }));

    const myRow = await view.findByTestId(`application-row-${MINE}`);
    const notice = await view.findByTestId('application-sod-blocked');
    expect(notice.textContent).toMatch(/you submitted this application/i);
    expect(notice.textContent).toMatch(/separation of duties/i);
    // The decision buttons must be absent on this row, not merely disabled.
    expect(myRow.querySelector('button')?.textContent).not.toBe('Approve');
    expect(Array.from(myRow.querySelectorAll('button')).map((b) => b.textContent)).not.toContain(
      'Approve',
    );
  });

  it('still offers Approve to the same operator on somebody else’s application', async () => {
    const view = render(<AgentNetworkScreen />);
    fireEvent.click(await view.findByRole('button', { name: 'Load applications' }));
    const theirRow = await view.findByTestId(`application-row-${THEIRS}`);

    await waitFor(() =>
      expect(
        Array.from(theirRow.querySelectorAll('button')).map((b) => b.textContent),
      ).toContain('Approve'),
    );
    // No explanation on a row the operator did not submit.
    expect(view.queryAllByTestId('application-sod-blocked')).toHaveLength(1);
  });
});
