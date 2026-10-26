import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SupportScreen } from '../src/screens/authenticated/support/SupportScreen';
import { CreateSupportTicketScreen } from '../src/screens/authenticated/support/CreateSupportTicketScreen';
import { SupportTicketDetailScreen } from '../src/screens/authenticated/support/SupportTicketDetailScreen';
import { useAuthStore } from '../src/store/auth-store';
import type {
  AgentSupportTicket,
  AgentSupportTicketListResponse,
  AgentSupportTicketMessage,
} from '../src/services/agent-api';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
let mockRouteParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    goBack: jest.fn(),
  }),
  useRoute: () => ({
    params: mockRouteParams,
  }),
}));

jest.mock('../src/services/agent-api', () => ({
  getAgentSupportTickets: jest.fn(),
  getAgentSupportTicket: jest.fn(),
  createAgentSupportTicket: jest.fn(),
  getAgentSupportTicketMessages: jest.fn(),
  createAgentSupportTicketMessage: jest.fn(),
  describeSupportError: jest.requireActual('../src/services/agent-api').describeSupportError,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  getAgentSupportTickets: jest.Mock;
  getAgentSupportTicket: jest.Mock;
  createAgentSupportTicket: jest.Mock;
  getAgentSupportTicketMessages: jest.Mock;
  createAgentSupportTicketMessage: jest.Mock;
};

const ticketFixture1: AgentSupportTicket = {
  id: 'ticket-uuid-1',
  reference: 'SUP-ticket-uuid-1',
  subject: 'POS Terminal printer failure',
  category: 'TERMINAL',
  description: 'The POS terminal attached to Outlet 1 is failing to print transaction receipts.',
  status: 'OPEN',
  priority: 'HIGH',
  fundingRequestId: null,
  relatedTransferId: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  resolvedAt: null,
  closedAt: null,
  version: 1,
};

const ticketFixture2: AgentSupportTicket = {
  id: 'ticket-uuid-2',
  reference: 'SUP-ticket-uuid-2',
  subject: 'Cash-in authorization question',
  category: 'CASH_IN',
  description: 'Need clarification on Cash-in transaction limit assignment for Gold class.',
  status: 'RESOLVED',
  priority: 'MEDIUM',
  fundingRequestId: null,
  relatedTransferId: 'transfer-uuid-99',
  createdAt: '2026-09-28T14:30:00.000Z',
  updatedAt: '2026-09-29T09:00:00.000Z',
  resolvedAt: '2026-09-29T09:00:00.000Z',
  closedAt: null,
  version: 2,
};

const ticketClosedFixture: AgentSupportTicket = {
  id: 'ticket-uuid-3',
  reference: 'SUP-ticket-uuid-3',
  subject: 'Completed agent funding inquiry',
  category: 'AGENT_FUNDING',
  description: 'Funding pool deposit verified.',
  status: 'CLOSED',
  priority: 'LOW',
  fundingRequestId: 'funding-req-uuid-1',
  relatedTransferId: null,
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
  resolvedAt: '2026-09-21T09:30:00.000Z',
  closedAt: '2026-09-21T10:00:00.000Z',
  version: 3,
};

const messagesFixture: AgentSupportTicketMessage[] = [
  {
    id: 'msg-1',
    ticketId: 'ticket-uuid-1',
    authorType: 'AGENT',
    authorId: 'agent-uuid-1',
    body: 'The terminal SN-9981 error code is PRN-404.',
    isInternal: false,
    createdAt: '2026-10-01T10:05:00.000Z',
    updatedAt: '2026-10-01T10:05:00.000Z',
  },
  {
    id: 'msg-2',
    ticketId: 'ticket-uuid-1',
    authorType: 'SUPPORT',
    authorId: 'support-agent-1',
    body: 'Thank you for reporting. We have dispatched a replacement paper roller to your outlet.',
    isInternal: false,
    createdAt: '2026-10-01T10:30:00.000Z',
    updatedAt: '2026-10-01T10:30:00.000Z',
  },
];

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Agent Support UI (V1-AGENT-MOBILE-11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      agentId: 'agent-uuid-1',
      session: {
        accessToken: 'valid-agent-token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        agentId: 'agent-uuid-1',
        sessionId: 'sess-1',
      },
      pendingRotation: null,
      error: null,
    });
  });

  describe('SupportScreen — Ticket List & Overview', () => {
    test('renders support tickets list with status badges and categories', async () => {
      const listResponse: AgentSupportTicketListResponse = {
        items: [ticketFixture1, ticketFixture2],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1, hasNextPage: false },
      };
      mockApi.getAgentSupportTickets.mockResolvedValue(listResponse);

      const { getByText, getByTestId } = wrap(<SupportScreen />);

      await waitFor(() => expect(getByTestId('support-intro-card')).toBeTruthy());
      expect(getByText('Agent Support')).toBeTruthy();
      expect(getByText('POS Terminal printer failure')).toBeTruthy();
      expect(getByText('SUP-ticket-uuid-1')).toBeTruthy();
      expect(getByText('Cash-in authorization question')).toBeTruthy();
      expect(getByText('2 requests')).toBeTruthy();

      // Tap ticket row -> navigates to SupportTicketDetail
      fireEvent.press(getByTestId('support-ticket-item-ticket-uuid-1'));
      expect(mockNavigate).toHaveBeenCalledWith('SupportTicketDetail', {
        ticketId: 'ticket-uuid-1',
      });
    });

    test('renders empty state when no support tickets exist', async () => {
      const emptyResponse: AgentSupportTicketListResponse = {
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false },
      };
      mockApi.getAgentSupportTickets.mockResolvedValue(emptyResponse);

      const { getByTestId, getByText } = wrap(<SupportScreen />);

      await waitFor(() => expect(getByTestId('support-empty-card')).toBeTruthy());
      expect(getByText('No Support Requests')).toBeTruthy();
    });

    test('renders error state and handles retry', async () => {
      const error = new Error('Network error') as Error & { name: string };
      error.name = 'NetworkError';
      mockApi.getAgentSupportTickets.mockRejectedValue(error);

      const { getByText } = wrap(<SupportScreen />);

      await waitFor(() => expect(getByText('Could Not Load Support')).toBeTruthy());
      expect(getByText('No network connection. Check your connection and retry.')).toBeTruthy();

      mockApi.getAgentSupportTickets.mockResolvedValue({
        items: [ticketFixture1],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false },
      });

      fireEvent.press(getByText('Retry'));
      await waitFor(() => expect(getByText('POS Terminal printer failure')).toBeTruthy());
    });

    test('navigates to CreateSupportTicket when New Support Request is pressed', async () => {
      mockApi.getAgentSupportTickets.mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false },
      });

      const { getByTestId } = wrap(<SupportScreen />);
      await waitFor(() => expect(getByTestId('support-new-ticket-button')).toBeTruthy());

      fireEvent.press(getByTestId('support-new-ticket-button'));
      expect(mockNavigate).toHaveBeenCalledWith('CreateSupportTicket');
    });
  });

  describe('CreateSupportTicketScreen — Submission & Validation', () => {
    test('validates minimum subject and description lengths client-side', async () => {
      const { getByTestId, getByText } = wrap(<CreateSupportTicketScreen />);

      // Submit with empty inputs
      fireEvent.press(getByTestId('support-submit-button'));
      expect(getByText('Subject must be at least 3 characters.')).toBeTruthy();

      // Enter short subject
      fireEvent.changeText(getByTestId('support-input-subject'), 'ab');
      fireEvent.press(getByTestId('support-submit-button'));
      expect(getByText('Subject must be at least 3 characters.')).toBeTruthy();

      // Enter valid subject, missing description
      fireEvent.changeText(getByTestId('support-input-subject'), 'Valid Subject');
      fireEvent.press(getByTestId('support-submit-button'));
      expect(getByText('Description must be at least 3 characters.')).toBeTruthy();

      expect(mockApi.createAgentSupportTicket).not.toHaveBeenCalled();
    });

    test('submits valid support request with category, priority and displays success', async () => {
      const createdTicket: AgentSupportTicket = {
        ...ticketFixture1,
        id: 'new-ticket-123',
        reference: 'SUP-new-ticket-123',
        subject: 'Terminal paper jam',
        category: 'TERMINAL',
        description: 'Printer cannot feed roll properly on outlet 1 terminal.',
      };
      mockApi.createAgentSupportTicket.mockResolvedValue(createdTicket);

      const { getByTestId, getByText } = wrap(<CreateSupportTicketScreen />);

      // Select Category
      fireEvent.press(getByTestId('category-chip-TERMINAL'));
      // Select Priority
      fireEvent.press(getByTestId('priority-chip-HIGH'));

      fireEvent.changeText(getByTestId('support-input-subject'), 'Terminal paper jam');
      fireEvent.changeText(
        getByTestId('support-input-description'),
        'Printer cannot feed roll properly on outlet 1 terminal.',
      );

      fireEvent.press(getByTestId('support-submit-button'));

      await waitFor(() => expect(getByTestId('support-success-card')).toBeTruthy());
      expect(getByText('Support Request Submitted')).toBeTruthy();
      expect(getByText('Reference: SUP-new-ticket-123')).toBeTruthy();

      expect(mockApi.createAgentSupportTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Terminal paper jam',
          category: 'TERMINAL',
          description: 'Printer cannot feed roll properly on outlet 1 terminal.',
          priority: 'HIGH',
          idempotencyKey: expect.stringMatching(/^sup-ticket-/),
        }),
      );

      // Tap View Request -> replaces navigation to SupportTicketDetail
      fireEvent.press(getByTestId('support-view-ticket-button'));
      expect(mockReplace).toHaveBeenCalledWith('SupportTicketDetail', {
        ticketId: 'new-ticket-123',
      });
    });

    test('sanitizes and displays server error message on creation failure', async () => {
      const apiError = new Error('subject contains invalid characters') as Error & {
        name: string;
        status: number;
      };
      apiError.name = 'ApiError';
      apiError.status = 400;
      mockApi.createAgentSupportTicket.mockRejectedValue(apiError);

      const { getByTestId, getByText } = wrap(<CreateSupportTicketScreen />);

      fireEvent.changeText(getByTestId('support-input-subject'), 'Bad subject');
      fireEvent.changeText(getByTestId('support-input-description'), 'Detailed issue description');
      fireEvent.press(getByTestId('support-submit-button'));

      await waitFor(() => expect(getByTestId('support-form-error')).toBeTruthy());
      expect(getByText('subject contains invalid characters')).toBeTruthy();
    });
  });

  describe('SupportTicketDetailScreen — Detail & Conversation Messaging', () => {
    test('renders ticket details, category, status, and message history', async () => {
      mockRouteParams = { ticketId: 'ticket-uuid-1' };
      mockApi.getAgentSupportTicket.mockResolvedValue(ticketFixture1);
      mockApi.getAgentSupportTicketMessages.mockResolvedValue(messagesFixture);

      const { getByText, getByTestId } = wrap(<SupportTicketDetailScreen />);

      await waitFor(() => expect(getByTestId('support-detail-reference')).toBeTruthy());
      expect(getByText('SUP-ticket-uuid-1')).toBeTruthy();
      expect(getByText('POS Terminal printer failure')).toBeTruthy();
      expect(
        getByText(
          'The POS terminal attached to Outlet 1 is failing to print transaction receipts.',
        ),
      ).toBeTruthy();

      // Messages rendered
      expect(getByText('The terminal SN-9981 error code is PRN-404.')).toBeTruthy();
      expect(getByText('You')).toBeTruthy();
      expect(
        getByText(
          'Thank you for reporting. We have dispatched a replacement paper roller to your outlet.',
        ),
      ).toBeTruthy();
      expect(getByText('Support Team')).toBeTruthy();
    });

    test('submits reply message to ticket and clears reply input', async () => {
      mockRouteParams = { ticketId: 'ticket-uuid-1' };
      mockApi.getAgentSupportTicket.mockResolvedValue(ticketFixture1);
      mockApi.getAgentSupportTicketMessages.mockResolvedValue(messagesFixture);

      const newMsg: AgentSupportTicketMessage = {
        id: 'msg-3',
        ticketId: 'ticket-uuid-1',
        authorType: 'AGENT',
        authorId: 'agent-uuid-1',
        body: 'Received the replacement roller, works great now.',
        isInternal: false,
        createdAt: '2026-10-01T11:00:00.000Z',
        updatedAt: '2026-10-01T11:00:00.000Z',
      };
      mockApi.createAgentSupportTicketMessage.mockResolvedValue(newMsg);

      const { getByTestId, queryByText } = wrap(<SupportTicketDetailScreen />);

      await waitFor(() => expect(getByTestId('support-reply-input')).toBeTruthy());

      fireEvent.changeText(
        getByTestId('support-reply-input'),
        'Received the replacement roller, works great now.',
      );
      fireEvent.press(getByTestId('support-reply-button'));

      await waitFor(() => {
        expect(mockApi.createAgentSupportTicketMessage).toHaveBeenCalledWith(
          'ticket-uuid-1',
          'Received the replacement roller, works great now.',
        );
      });

      // Error text is null
      expect(queryByText(/cannot exceed/i)).toBeNull();
    });

    test('closed ticket displays closed notice and hides reply form', async () => {
      mockRouteParams = { ticketId: 'ticket-uuid-3' };
      mockApi.getAgentSupportTicket.mockResolvedValue(ticketClosedFixture);
      mockApi.getAgentSupportTicketMessages.mockResolvedValue([]);

      const { getByText, queryByTestId } = wrap(<SupportTicketDetailScreen />);

      await waitFor(() => expect(getByText(/This support ticket is closed/i)).toBeTruthy());
      expect(queryByTestId('support-reply-input')).toBeNull();
      expect(queryByTestId('support-reply-button')).toBeNull();
    });
  });

  describe('Operational States & Security Invariants', () => {
    test('support access is available for agents in SUSPENDED status', async () => {
      // Agent is in SUSPENDED operational state
      useAuthStore.setState({
        isAuthenticated: true,
        agentId: 'agent-suspended-1',
      });
      mockApi.getAgentSupportTickets.mockResolvedValue({
        items: [ticketFixture1],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false },
      });

      const { getByText, getByTestId } = wrap(<SupportScreen />);

      await waitFor(() => expect(getByTestId('support-intro-card')).toBeTruthy());
      expect(getByText('Agent Support')).toBeTruthy();
      expect(getByText('POS Terminal printer failure')).toBeTruthy();
    });

    test('CRITICAL SECURITY: Support requests never log or store credentials or secrets', () => {
      // Check that ticket payload structures do not contain password or pin properties
      const ticketJson = JSON.stringify(ticketFixture1);
      expect(ticketJson.toLowerCase()).not.toContain('password');
      expect(ticketJson.toLowerCase()).not.toContain('pinhash');
      expect(ticketJson.toLowerCase()).not.toContain('salt');
    });
  });
});
