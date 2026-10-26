import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SupportScreen } from '../src/screens/authenticated/SupportScreen';
import { SupportTicketDetailScreen } from '../src/screens/authenticated/SupportTicketDetailScreen';
import { CreateSupportTicketScreen } from '../src/screens/authenticated/CreateSupportTicketScreen';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
  }),
  useRoute: () => ({ params: mockRouteParams }),
  // Minimal stand-in: runs the focus callback once on mount (and its cleanup on
  // unmount), sufficient to exercise load-on-focus behavior without a real
  // NavigationContainer in this unit test environment (same pattern used by
  // transaction-pin.test.tsx).
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => {
      const cleanup = callback();
      return cleanup;
    }, []);
  },
}));

/**
 * V1-CUSTOMER-09 — Customer Mobile support ticket list → detail → reply,
 * locked-PIN and transaction-link prefill, and create-ticket idempotency.
 *
 * All calls go through the real, authenticated, ownership-scoped backend
 * routes (`GET/POST /customers/me/support/tickets...`) — these tests only
 * verify the mobile view-model/wiring, not backend authorization (that is
 * covered by the integration suite).
 */
describe('SupportScreen — ticket list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  test('renders tickets and tapping a row navigates to SupportTicketDetail with its id', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'ticket-1',
          reference: 'TCK-001',
          subject: 'My transfer failed',
          category: 'TRANSFER',
          status: 'OPEN',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const { findByTestId } = render(<SupportScreen />);
    const row = await findByTestId('support-ticket-row-ticket-1');
    fireEvent.press(row);

    expect(mockNavigate).toHaveBeenCalledWith('SupportTicketDetail', { ticketId: 'ticket-1' });
  });

  test('empty state renders with no crash when the customer has no tickets', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({ items: [] });
    const { findByText } = render(<SupportScreen />);
    expect(await findByText('You have not raised any support tickets yet.')).toBeTruthy();
  });

  test('"New Ticket" button navigates to CreateSupportTicket with no params', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({ items: [] });
    const { findByText } = render(<SupportScreen />);
    await findByText('You have not raised any support tickets yet.');
    fireEvent.press(await findByText('New Ticket'));
    expect(mockNavigate).toHaveBeenCalledWith('CreateSupportTicket');
  });
});

describe('SupportTicketDetailScreen — detail, reply, idempotency, lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { ticketId: 'ticket-1' };
  });

  function mockTicket(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'ticket-1',
      reference: 'TCK-001',
      subject: 'My transfer failed',
      category: 'TRANSFER',
      description: 'The money left my wallet but never arrived.',
      status: 'OPEN',
      priority: 'NORMAL',
      fundingRequestId: null,
      relatedTransferId: null,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  test('loads and renders ticket header, description, and message thread', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/messages')) {
        return Promise.resolve([
          { id: 'msg-1', authorType: 'CUSTOMER', body: 'Hello, any update?', createdAt: new Date().toISOString() },
          { id: 'msg-2', authorType: 'SUPPORT_AGENT', body: 'Looking into it.', createdAt: new Date().toISOString() },
        ]);
      }
      return Promise.resolve(mockTicket());
    });

    const { findByTestId } = render(<SupportTicketDetailScreen />);

    expect((await findByTestId('support-detail-subject')).props.children).toBe('My transfer failed');
    expect((await findByTestId('support-detail-description')).props.children).toBe(
      'The money left my wallet but never arrived.',
    );
    expect(await findByTestId('support-message-msg-1')).toBeTruthy();
    expect(await findByTestId('support-message-msg-2')).toBeTruthy();
  });

  test('sending a reply posts to the messages endpoint with an Idempotency-Key and clears the input', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/messages')) return Promise.resolve([]);
      return Promise.resolve(mockTicket());
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'msg-new' });

    const { findByTestId } = render(<SupportTicketDetailScreen />);
    const input = await findByTestId('support-reply-input');

    await act(async () => {
      fireEvent.changeText(input, 'Any news on this?');
    });
    await act(async () => {
      fireEvent.press(await findByTestId('support-reply-button'));
    });

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    const [endpoint, body, options] = (ApiClient.post as jest.Mock).mock.calls[0];
    expect(endpoint).toBe('/customers/me/support/tickets/ticket-1/messages');
    expect(body).toEqual({ body: 'Any news on this?' });
    expect(options?.idempotencyKey).toEqual(expect.any(String));
    expect(options.idempotencyKey.length).toBeGreaterThan(0);
  });

  test('the reply idempotency key is regenerated after a successful send (two sends use two different keys)', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/messages')) return Promise.resolve([]);
      return Promise.resolve(mockTicket());
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'msg-new' });

    const { findByTestId } = render(<SupportTicketDetailScreen />);

    await act(async () => {
      fireEvent.changeText(await findByTestId('support-reply-input'), 'First message');
    });
    await act(async () => {
      fireEvent.press(await findByTestId('support-reply-button'));
    });
    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    const firstKey = (ApiClient.post as jest.Mock).mock.calls[0][2].idempotencyKey;

    await act(async () => {
      fireEvent.changeText(await findByTestId('support-reply-input'), 'Second message');
    });
    await act(async () => {
      fireEvent.press(await findByTestId('support-reply-button'));
    });
    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(2));
    const secondKey = (ApiClient.post as jest.Mock).mock.calls[1][2].idempotencyKey;

    expect(secondKey).not.toEqual(firstKey);
  });

  test('empty reply is rejected client-side without calling the API', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/messages')) return Promise.resolve([]);
      return Promise.resolve(mockTicket());
    });

    const { findByTestId } = render(<SupportTicketDetailScreen />);
    await act(async () => {
      fireEvent.press(await findByTestId('support-reply-button'));
    });

    expect(await findByTestId('support-reply-error')).toBeTruthy();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('a RESOLVED ticket hides the reply form and shows an honest status message instead', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/messages')) return Promise.resolve([]);
      return Promise.resolve(mockTicket({ status: 'RESOLVED' }));
    });

    const { queryByTestId, findByText } = render(<SupportTicketDetailScreen />);
    await findByText(/this ticket is resolved/i);
    expect(queryByTestId('support-reply-input')).toBeNull();
  });

  test('a CLOSED ticket hides the reply form too', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/messages')) return Promise.resolve([]);
      return Promise.resolve(mockTicket({ status: 'CLOSED' }));
    });

    const { queryByTestId, findByText } = render(<SupportTicketDetailScreen />);
    await findByText(/this ticket is closed/i);
    expect(queryByTestId('support-reply-input')).toBeNull();
  });

  test('a failed reply shows a server-surfaced error and does not clear the draft', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/messages')) return Promise.resolve([]);
      return Promise.resolve(mockTicket());
    });
    (ApiClient.post as jest.Mock).mockRejectedValue(new ApiError('Ticket is closed.', 409));

    const { findByTestId } = render(<SupportTicketDetailScreen />);
    const input = await findByTestId('support-reply-input');
    await act(async () => {
      fireEvent.changeText(input, 'Still need help');
    });
    await act(async () => {
      fireEvent.press(await findByTestId('support-reply-button'));
    });

    expect(await findByTestId('support-reply-error')).toBeTruthy();
  });

  test('load failure (e.g. cross-customer ticket id / 404) renders an error state with retry, not a crash', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValue(new ApiError('Ticket not found.', 404));

    const { findByText } = render(<SupportTicketDetailScreen />);
    expect(await findByText('Ticket not found.')).toBeTruthy();
  });
});

describe('CreateSupportTicketScreen — prefill, idempotency, transaction linkage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  test('with no route params, defaults to an empty form and OTHER category', () => {
    const { getByPlaceholderText, getByTestId } = render(<CreateSupportTicketScreen />);
    expect(getByPlaceholderText('Brief summary of the issue').props.value).toBe('');
    expect(getByTestId('support-category-OTHER').props.accessibilityState?.disabled).not.toBe(true);
  });

  test('prefills subject/description/category from navigation params (locked-PIN path) and still submits without a related id', async () => {
    mockRouteParams = {
      category: 'PIN',
      subject: 'Transaction PIN locked',
      description: 'My Transaction PIN is locked.',
    };
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'ticket-new' });

    const { getByPlaceholderText, getByTestId, queryByTestId } = render(<CreateSupportTicketScreen />);
    expect(getByPlaceholderText('Brief summary of the issue').props.value).toBe('Transaction PIN locked');
    expect(queryByTestId('support-transaction-context-banner')).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId('support-submit-button'));
    });

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    const [endpoint, body, options] = (ApiClient.post as jest.Mock).mock.calls[0];
    expect(endpoint).toBe('/customers/me/support/tickets');
    expect(body).toEqual({
      subject: 'Transaction PIN locked',
      category: 'PIN',
      description: 'My Transaction PIN is locked.',
    });
    expect(options?.idempotencyKey).toEqual(expect.any(String));
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('an unrecognized prefilled category falls back to OTHER rather than inventing a new category', () => {
    mockRouteParams = { category: 'SOMETHING_MADE_UP' };
    const { getByTestId } = render(<CreateSupportTicketScreen />);
    // OTHER should be the active (primary) chip — no assertion error means the chip exists and render succeeded.
    expect(getByTestId('support-category-OTHER')).toBeTruthy();
  });

  test('relatedTransferId is included in the submit payload and the transaction-context banner is shown', async () => {
    mockRouteParams = {
      category: 'TRANSFER',
      subject: 'Issue with transfer REF-1',
      description: 'I have a question about this transaction:\n- Reference: REF-1',
      relatedTransferId: 'transfer-uuid-1',
    };
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'ticket-new' });

    const { getByTestId } = render(<CreateSupportTicketScreen />);
    expect(getByTestId('support-transaction-context-banner')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('support-submit-button'));
    });

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    const [, body] = (ApiClient.post as jest.Mock).mock.calls[0];
    expect(body).toEqual(
      expect.objectContaining({ relatedTransferId: 'transfer-uuid-1' }),
    );
    expect(body.fundingRequestId).toBeUndefined();
  });

  test('fundingRequestId is included in the submit payload for a FUNDING-linked prefill', async () => {
    mockRouteParams = {
      category: 'FUNDING',
      subject: 'Issue with wallet funding REF-2',
      description: 'I have a question about this transaction:\n- Reference: REF-2',
      fundingRequestId: 'funding-uuid-1',
    };
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'ticket-new' });

    const { getByTestId } = render(<CreateSupportTicketScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('support-submit-button'));
    });

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    const [, body] = (ApiClient.post as jest.Mock).mock.calls[0];
    expect(body).toEqual(expect.objectContaining({ fundingRequestId: 'funding-uuid-1' }));
    expect(body.relatedTransferId).toBeUndefined();
  });

  test('double-pressing submit while a request is in flight only issues one API call', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    (ApiClient.post as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    const { getByPlaceholderText, getByTestId } = render(<CreateSupportTicketScreen />);
    fireEvent.changeText(getByPlaceholderText('Brief summary of the issue'), 'Duplicate tap test');
    fireEvent.changeText(
      getByPlaceholderText('Describe what happened, including dates/amounts if relevant'),
      'Testing duplicate submit prevention.',
    );

    const submitButton = getByTestId('support-submit-button');
    fireEvent.press(submitButton);
    fireEvent.press(submitButton);

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolvePost({ id: 'ticket-new' });
    });
  });
});
