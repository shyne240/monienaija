import React, { useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { DEV_AUTH_MOCK } from '../../config';

export const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [bootstrapInput, setBootstrapInput] = useState('');
  const [advancedTab, setAdvancedTab] = useState<'oidc' | 'bootstrap'>('oidc');
  const [valError, setValError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { loginWithPassword, login, bootstrap, isLoading, error, clearError } = useAuthStore();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setValError('Email/username and password are required');
      return;
    }
    setValError('');
    clearError();
    setSuccessMsg('');

    try {
      await loginWithPassword(email, password);
    } catch {
      // Handled by store
    }
  };

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

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoSection}>
          <img src="/favicon.png" alt="MonieNaija" style={styles.logoIcon} />
          <h1 style={styles.logoText}>MonieNaija</h1>
          <p style={styles.logoTag}>Operational & Business Administration</p>
        </div>

        {DEV_AUTH_MOCK && (
          <div style={styles.devBanner}>
            <span style={styles.devBannerTitle}>Local development build</span>
            <p style={styles.devBannerText}>
              Sign in with your workforce email and password. A deterministic default local
              administrator can be created with <code>node scripts/local-dev-seed-admin.js</code>
              {' '}(see docs/V1/V1-ADMIN-LOCAL-LOGIN-01.md).
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

        <form onSubmit={handleSignIn} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label} htmlFor="admin-login-email">Email or username</label>
            <input
              id="admin-login-email"
              style={styles.input}
              type="text"
              autoComplete="username"
              placeholder="admin@monienaija.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label} htmlFor="admin-login-password">Password</label>
            <input
              id="admin-login-password"
              style={styles.input}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={styles.submitBtn}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {DEV_AUTH_MOCK && (
          <div style={styles.advancedSection}>
            <button
              type="button"
              style={styles.advancedToggle}
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? '▲ Hide advanced (engineering) options' : '▼ Advanced: OIDC / Bootstrap (engineering only)'}
            </button>

            {showAdvanced && (
              <div>
                <div style={styles.tabHeader}>
                  <button
                    type="button"
                    style={advancedTab === 'oidc' ? styles.activeTabBtn : styles.tabBtn}
                    onClick={() => { setAdvancedTab('oidc'); setValError(''); }}
                  >
                    OIDC Ingress Login
                  </button>
                  <button
                    type="button"
                    style={advancedTab === 'bootstrap' ? styles.activeTabBtn : styles.tabBtn}
                    onClick={() => { setAdvancedTab('bootstrap'); setValError(''); }}
                  >
                    Bootstrap Authority
                  </button>
                </div>

                {advancedTab === 'oidc' ? (
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
                    <button type="submit" disabled={isLoading} style={styles.submitBtn}>
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
                    <button type="submit" disabled={isLoading} style={styles.submitBtn}>
                      {isLoading ? 'Consuming Statement...' : 'Consume Bootstrap Statement'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
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
    // V1-ADMIN-UAT-READINESS-01: the real, already-approved MonieNaija "M" mark
    // (apps/admin-web/public/favicon.png, wired in commit 2a05c62) replaces the previous
    // plain-text "₦" glyph-in-a-circle placeholder — no new asset, no redesign.
    width: '72px',
    height: '72px',
    objectFit: 'contain' as const,
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
  devBanner: {
    backgroundColor: '#F0F9F4',
    borderColor: '#0A3D25',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '20px',
  },
  devBannerTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#0A3D25',
    display: 'block',
    marginBottom: '4px',
  },
  devBannerText: {
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
  input: {
    height: '44px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '14px',
    color: '#1E293B',
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
  advancedSection: {
    marginTop: '24px',
    paddingTop: '16px',
    borderTop: '1px dashed #E2E8F0',
  },
  advancedToggle: {
    width: '100%',
    textAlign: 'left' as const,
    backgroundColor: 'transparent',
    border: 'none',
    color: '#64748B',
    fontSize: '12px',
    fontWeight: '600',
    padding: '4px 0',
    cursor: 'pointer',
  },
};
