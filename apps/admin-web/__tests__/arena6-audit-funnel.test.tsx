import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AuditInspectionScreen } from '../src/screens/authenticated/AuditInspectionScreen';
import { AuditTrailScreen } from '../src/screens/authenticated/AuditTrailScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

/**
 * ARENA 6 — the audit end of the drill-down funnel.
 *
 * Two screens can be the far side of a click: the audit workspace reached from a delivery record with
 * a correlation identifier, and the inspector an operator uses to choose their own question. What both
 * must never do is let an *unasked* filter look like an *answered* one — so a pre-filled search has to
 * say it was pre-filled, a window has to be shown as the window that was sent, and an absent time bound
 * has to read as "no bound" rather than as "all time, and nothing happened".
 */

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn() },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
const calls = ApiClient.get as jest.Mock;

const session = (scopes: string[]) =>
  useAuthStore.setState({
    isAuthenticated: true,
    token: 's',
    sessionId: 's',
    principal: {
      type: 'OPERATOR',
      principalId: 'operator',
      sessionId: 's',
      audience: 'workforce-admin',
      roles: ['OPERATIONS'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    } as any,
  });

const page = {
  data: [
    {
      id: 'evt-1',
      occurredAt: '2026-11-22T06:00:00Z',
      actor: 'workforce-principal-a',
      action: 'notification.delivery.failed',
      entityType: 'NOTIFICATION_DELIVERY',
      entityId: 'd1',
      outcome: 'ALLOWED',
      institutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      correlationId: 'corr-77',
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
  totalPages: 1,
  accessMode: 'READ_ONLY',
  excludedCategories: ['CUSTOMER_PREFERENCE'],
};

beforeEach(() => {
  jest.resetAllMocks();
  session(['audit.search', 'audit.view']);
  calls.mockResolvedValue(page);
});

describe('ARENA 6 — audit funnel', () => {
  it('runs the pre-filled correlation search and keeps it visible', async () => {
    render(<AuditTrailScreen initialCorrelationId="corr-77" />);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith(expect.stringContaining('correlationId=corr-77')),
    );
    const input = screen.getByLabelText(/correlation/i) as HTMLInputElement;
    expect(input.value).toBe('corr-77');
    expect(await screen.findByText('notification.delivery.failed')).toBeTruthy();
  });

  it('sends the resource and correlation fields the operator typed', async () => {
    render(<AuditInspectionScreen />);
    // The submit control is disabled while a read is in flight, so the first response is awaited
    // before the operator's own search is typed and sent.
    await screen.findByText('notification.delivery.failed');
    fireEvent.change(screen.getByLabelText('Resource ID'), { target: { value: 'd1' } });
    fireEvent.change(screen.getByLabelText('Correlation ID'), {
      target: { value: 'corr-77' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search audit records/i }));
    await waitFor(() => {
      // The *submitted* search, not the mount read: the initial request is unfiltered by design.
      const paths = calls.mock.calls.map(([path]) => String(path));
      expect(paths.some((path) => path.includes('entityId=d1') && path.includes('correlationId=corr-77'))).toBe(
        true,
      );
    });
    // The applied line is a record of what was sent, so a filter that silently dropped is visible.
    expect(screen.getByTestId('a4-audit-applied-filters').textContent).toContain('resource d1');
    expect(screen.getByTestId('a4-audit-applied-filters').textContent).toContain(
      'correlation corr-77',
    );
  });

  it('states an open window as open instead of implying full history', async () => {
    render(<AuditInspectionScreen />);
    const line = screen.getByTestId('a4-audit-applied-filters');
    expect(line.textContent).toContain('any resource id');
    expect(line.textContent).toContain('any correlation');
    // No search has been run yet, and the wording says "no time window" rather than leaving blanks
    // that could be read as an unbounded history that came back empty.
    expect(line.textContent).toContain('no time window');
  });

  it('time-window presets write real bounds, and the applied line waits for the search', async () => {
    render(<AuditInspectionScreen />);
    await screen.findByText('notification.delivery.failed');
    fireEvent.click(screen.getByRole('button', { name: 'Last 24 hours' }));
    const from = screen.getByLabelText('From') as HTMLInputElement;
    const to = screen.getByLabelText('To') as HTMLInputElement;
    expect(from.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(to.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // A preset edits the draft only. The applied line describes the search that actually ran, so an
    // unsent filter can never read as a criterion the server honoured.
    expect(screen.getByTestId('a4-audit-applied-filters').textContent).toContain('no time window');

    fireEvent.click(screen.getByRole('button', { name: /search audit records/i }));
    await waitFor(() =>
      expect(screen.getByTestId('a4-audit-applied-filters').textContent).toMatch(
        /\d{1,2}\/\d{1,2}\/\d{4}.*→/,
      ),
    );
    const sent = calls.mock.calls.map(([path]) => String(path)).join(' ');
    expect(sent).toContain('from=');
    expect(sent).toContain('to=');

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    const widerFrom = new Date(
      (screen.getByLabelText('From') as HTMLInputElement).value,
    ).getTime();
    const newTo = new Date((screen.getByLabelText('To') as HTMLInputElement).value).getTime();
    expect(newTo - widerFrom).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);

    fireEvent.click(screen.getByRole('button', { name: 'No window' }));
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('');
  });

  it('reports an unusable search as a failure, never as zero matches', async () => {
    // A payload the console cannot verify must not be rendered as "the audit store found nothing".
    calls.mockResolvedValue({ unexpected: 'shape' });
    render(<AuditInspectionScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/could not be verified/i);
    expect(alert.textContent).toMatch(/not a search that found nothing/i);
    expect(screen.queryByText(/no audit records match/i)).toBeNull();
  });
});
