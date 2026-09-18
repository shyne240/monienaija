import React, { useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { DEV_AUTH_MOCK } from '../../config';

export const LoginScreen: React.FC = () => {
  const [tokenInput, setTokenInput] = useState('');
  const [bootstrapInput, setBootstrapInput] = useState('');
  const [activeTab, setActiveTab] = useState<'oidc' | 'bootstrap'>('oidc');
  const [valError, setValError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { login, bootstrap, isLoading, error, clearError } = useAuthStore();

  const handleOidcLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) {
      setValError('OIDC ID Token is required');
      return;
    }
    setValError('');
    clearError();
    setSuccessMsg('');

    try {
      await login(tokenInput);
    } catch {
      // Handled by store
    }
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bootstrapInput.trim()) {
      setValError('Bootstrap Statement JWS is required');
      return;
    }
    setValError('');
    clearError();
    setSuccessMsg('');

    try {
      await bootstrap(bootstrapInput);
      setSuccessMsg('Bootstrap statement consumed successfully! You can now log in.');
      setBootstrapInput('');
    } catch {
      // Handled by store
    }
  };

  const fillMockToken = () => {
    setTokenInput('mock-sandbox-token-ADMIN');
  };

  const fillMockBootstrap = () => {
    setBootstrapInput('mock-bootstrap-jws-statement-preparer-controller-auditor');
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoSection}>
          <span style={styles.logoIcon}>₦</span>
          <h1 style={styles.logoText}>MoneyNaija</h1>
          <p style={styles.logoTag}>Operational & Business Administration</p>
        </div>

        {DEV_AUTH_MOCK ? (
          <div style={styles.sandboxBanner}>
            <span style={styles.sandboxTitle}>⚙️ Sandbox Development Mode</span>
            <p style={styles.sandboxText}>
              Standard OIDC/bootstrap authentication is active. Quick mock credentials bypass is enabled for sandbox operators.
            </p>
          </div>
        ) : (
          <div style={styles.productionBanner}>
            <span style={styles.productionTitle}>⚠️ Production Security Enforced</span>
            <p style={styles.productionText}>
              Fail-closed gates are active. MFA-qualified signed JWS tokens are strictly required.
            </p>
          </div>
        )}

        {(!!valError || !!error) && (
          <div style={styles.errorBox}>
            {valError || error}
          </div>
        )}

        {!!successMsg && (
          <div style={styles.successBox}>
            {successMsg}
          </div>
        )}

        <div style={styles.tabHeader}>
          <button
            style={activeTab === 'oidc' ? styles.activeTabBtn : styles.tabBtn}
            onClick={() => { setActiveTab('oidc'); setValError(''); }}
          >
            OIDC Ingress Login
          </button>
          <button
            style={activeTab === 'bootstrap' ? styles.activeTabBtn : styles.tabBtn}
            onClick={() => { setActiveTab('bootstrap'); setValError(''); }}
          >
            Bootstrap Authority
          </button>
        </div>

        {activeTab === 'oidc' ? (
          <form onSubmit={handleOidcLogin} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Signed OIDC ID Assertion Token (Compact JWS)</label>
              <textarea
                style={styles.textarea}
                placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLg"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {DEV_AUTH_MOCK && (
              <button
                type="button"
                onClick={fillMockToken}
                style={styles.quickFillBtn}
              >
                ⚡ Autofill Sandbox Token
              </button>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={styles.submitBtn}
            >
              {isLoading ? 'Exchanging Session...' : 'Establish Session'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleBootstrap} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Finance Admin Bootstrap Statement (JWS)</label>
              <textarea
                style={styles.textarea}
                placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLg"
                value={bootstrapInput}
                onChange={(e) => setBootstrapInput(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {DEV_AUTH_MOCK && (
              <button
                type="button"
                onClick={fillMockBootstrap}
                style={styles.quickFillBtn}
              >
                ⚡ Autofill Sandbox Bootstrap
              </button>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={styles.submitBtn}
            >
              {isLoading ? 'Consuming Statement...' : 'Consume Bootstrap Statement'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#F8FAFC',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '20px',
  },
  card: {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1)',
    padding: '32px',
  },
  logoSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    marginBottom: '24px',
  },
  logoIcon: {
    fontSize: '48px',
    fontWeight: 'bold',
    color: '#FFB703',
    backgroundColor: '#0A3D25',
    width: '72px',
    height: '72px',
    borderRadius: '36px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '12px',
  },
  logoText: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 4px 0',
  },
  logoTag: {
    fontSize: '13px',
    color: '#64748B',
    margin: 0,
  },
  sandboxBanner: {
    backgroundColor: '#FFF8E6',
    borderColor: '#FFB703',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '20px',
  },
  sandboxTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#C88B00',
    display: 'block',
    marginBottom: '4px',
  },
  sandboxText: {
    fontSize: '11px',
    color: '#475569',
    margin: 0,
    lineHeight: '15px',
  },
  productionBanner: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '20px',
  },
  productionTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#EF4444',
    display: 'block',
    marginBottom: '4px',
  },
  productionText: {
    fontSize: '11px',
    color: '#475569',
    margin: 0,
    lineHeight: '15px',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    color: '#EF4444',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#EF4444',
  },
  successBox: {
    backgroundColor: '#D1FAE5',
    color: '#10B981',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#10B981',
  },
  tabHeader: {
    display: 'flex',
    borderBottom: '1px solid #E2E8F0',
    marginBottom: '20px',
  },
  tabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#64748B',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  activeTabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#0A3D25',
    border: 'none',
    borderBottom: '2px solid #0A3D25',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    marginBottom: '16px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#334155',
    marginBottom: '6px',
  },
  textarea: {
    height: '100px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '13px',
    fontFamily: 'monospace',
    resize: 'none' as const,
    color: '#1E293B',
  },
  quickFillBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#0A3D25',
    fontSize: '12px',
    fontWeight: '600',
    padding: '4px 0',
    marginBottom: '16px',
    cursor: 'pointer',
  },
  submitBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '14px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
};
