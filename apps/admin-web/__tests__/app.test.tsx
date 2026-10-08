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

  test('should render a real email/password LoginScreen by default when unauthenticated', () => {
    const { getByText, getByLabelText, queryByText } = render(<App />);
    expect(getByLabelText('Email or username')).toBeTruthy();
    expect(getByLabelText('Password')).toBeTruthy();
    expect(getByText('Sign In')).toBeTruthy();

    // The sandbox-token OIDC/Bootstrap workflow must not be presented as the normal login —
    // it is hidden behind an explicit "Advanced" toggle, not shown by default.
    expect(queryByText('OIDC Ingress Login')).toBeNull();
    expect(queryByText('Bootstrap Authority')).toBeNull();
    expect(queryByText('⚡ Autofill Sandbox Token')).toBeNull();
    expect(queryByText('mock-sandbox-token-ADMIN')).toBeNull();
  });

  test('should reveal the advanced OIDC/Bootstrap panel only after an explicit toggle', () => {
    const { getByText, queryByText } = render(<App />);
    expect(queryByText('OIDC Ingress Login')).toBeNull();

    fireEvent.click(getByText('▼ Advanced: OIDC / Bootstrap (engineering only)'));

    expect(getByText('OIDC Ingress Login')).toBeTruthy();
    expect(getByText('Bootstrap Authority')).toBeTruthy();
  });

  test('should submit email/password to the real local-admin-sessions backend endpoint', async () => {
    const mockSessionResponse = {
      accessToken: 'real-backend-bearer-123',
      tokenType: 'Bearer',
      sessionId: 'real-session-123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      principal: {
        type: 'PRIVILEGED',
        principalId: 'https://local-dev-identity.monienaija.invalid:mock-sandbox-subject',
        sessionId: 'real-session-123',
        audience: 'workforce-admin',
        roles: ['FINANCE_ADMIN', 'FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'FINANCE_AUDITOR'],
        scopes: ['privileged:execute', 'finance:prepare', 'privileged:approve', 'finance:audit'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    };
    (ApiClient.post as jest.Mock).mockResolvedValue(mockSessionResponse);

    const { getByLabelText, getByText } = render(<App />);
    fireEvent.change(getByLabelText('Email or username'), { target: { value: 'admin@monienaija.local' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'MonieNaijaAdmin123!' } });
    fireEvent.click(getByText('Sign In'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/local-admin-sessions', {
        email: 'admin@monienaija.local',
        password: 'MonieNaijaAdmin123!',
      });
      expect(getByText('System Administration Dashboard')).toBeTruthy();
    });
  });

  test('should show a clear error and stay on LoginScreen when credentials are rejected (401)', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(new Error('Invalid local administrator credentials'));

    const { getByLabelText, getByText, queryByText } = render(<App />);
    fireEvent.change(getByLabelText('Email or username'), { target: { value: 'admin@monienaija.local' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(getByText('Sign In'));

    await waitFor(() => {
      expect(getByText('Invalid local administrator credentials')).toBeTruthy();
    });
    expect(queryByText('System Administration Dashboard')).toBeNull();
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
