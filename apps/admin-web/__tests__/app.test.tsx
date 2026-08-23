import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('Admin Web Portal F1 Shell Tests', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = {};

    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, value: string) => { mockStorage[key] = value; },
        removeItem: (key: string) => { delete mockStorage[key]; },
        clear: () => { mockStorage = {}; },
      },
      writable: true,
    });

    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      token: null,
      sessionId: null,
      principal: null,
      error: null,
    });
  });

  test('should render LoginScreen by default when unauthenticated', () => {
    const { getByText, getByLabelText } = render(<App />);
    expect(getByText('OIDC Ingress Login')).toBeTruthy();
    expect(getByText('Bootstrap Authority')).toBeTruthy();
  });

  test('should render Dashboard and FINANCE_ADMIN sidebar link for FINANCE_ADMIN operator', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'admin-bearer',
      sessionId: 'admin-sess',
      principal: {
        type: 'PRIVILEGED',
        principalId: 'iss:test-admin-principal',
        sessionId: 'admin-sess',
        audience: 'workforce-admin',
        roles: ['FINANCE_ADMIN'],
        scopes: ['privileged:execute'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });

    const { getByText, queryByText, getAllByText } = render(<App />);

    expect(getByText('System Administration Dashboard')).toBeTruthy();
    expect(getAllByText('FINANCE_ADMIN').length).toBeGreaterThan(0);
    
    // Admin links must be present
    expect(getByText('🔑 Finance Role Admin')).toBeTruthy();
    
    // Controller links must NOT be present
    expect(queryByText('⚖️ Privileged Approvals')).toBeNull();
  });

  test('should render Dashboard and Privileged Approvals sidebar link for FINANCE_CONTROLLER operator', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'controller-bearer',
      sessionId: 'controller-sess',
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:test-controller-principal',
        sessionId: 'controller-sess',
        audience: 'workforce-admin',
        roles: ['FINANCE_CONTROLLER'],
        scopes: ['privileged:approve'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });

    const { getByText, queryByText, getAllByText } = render(<App />);

    expect(getByText('System Administration Dashboard')).toBeTruthy();
    expect(getAllByText('FINANCE_CONTROLLER').length).toBeGreaterThan(0);
    
    // Controller links must be present
    expect(getByText('⚖️ Privileged Approvals')).toBeTruthy();
    
    // Admin links must NOT be present
    expect(queryByText('🔑 Finance Role Admin')).toBeNull();
  });

  test('should render read-only Dashboard for FINANCE_AUDITOR operator without admin or controller controls', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'auditor-bearer',
      sessionId: 'auditor-sess',
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:test-auditor-principal',
        sessionId: 'auditor-sess',
        audience: 'workforce-admin',
        roles: ['FINANCE_AUDITOR'],
        scopes: ['finance:audit'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });

    const { getByText, queryByText, getAllByText } = render(<App />);

    expect(getByText('System Administration Dashboard')).toBeTruthy();
    expect(getAllByText('FINANCE_AUDITOR').length).toBeGreaterThan(0);
    
    // Admin & Controller controls must NOT be present
    expect(queryByText('🔑 Finance Role Admin')).toBeNull();
    expect(queryByText('⚖️ Privileged Approvals')).toBeNull();
  });

  test('should execute approvals POST trigger on form submit', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'controller-bearer',
      sessionId: 'controller-sess',
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:test-controller-principal',
        sessionId: 'controller-sess',
        audience: 'workforce-admin',
        roles: ['FINANCE_CONTROLLER'],
        scopes: ['privileged:approve'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });

    (ApiClient.post as jest.Mock).mockResolvedValue({ status: 'APPROVED' });

    const { getByText, getByPlaceholderText } = render(<App />);

    // Click approvals navigation
    fireEvent.click(getByText('⚖️ Privileged Approvals'));

    // Fill verification form
    fireEvent.change(getByPlaceholderText('e.g. 5e6f7g8h-1234-...'), { target: { value: 'approval-uuid-555' } });
    fireEvent.change(getByPlaceholderText('Provide context or explanation for auditing...'), { target: { value: 'Approved for pilot compliance check' } });

    // Submit
    fireEvent.click(getByText('Sign & Approve Action'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/a2/workforce/approvals/approval-uuid-555/approve',
        { comment: 'Approved for pilot compliance check' }
      );
      expect(getByText('Privileged action checked and approved successfully!')).toBeTruthy();
    });
  });
});
