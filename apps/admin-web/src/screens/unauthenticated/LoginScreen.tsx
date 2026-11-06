import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { DEV_AUTH_MOCK } from '../../config';
import '../../design-system/tokens.css';
import './login.css';

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

  useEffect(() => {
    return () => {
      setPassword('');
      setTokenInput('');
      setBootstrapInput('');
    };
  }, []);

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
      setPassword('');
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
    <div className="mn-login mn-login__container">
      <div className="mn-login__card">
        <div className="mn-login__logo-section">
          <img src="/favicon.png" alt="MonieNaija" className="mn-login__logo-icon" />
          <h1 className="mn-login__logo-text">MonieNaija</h1>
          <p className="mn-login__logo-tag">Operational & Business Administration</p>
        </div>

        {DEV_AUTH_MOCK && (
          <div className="mn-login__dev-banner">
            <span className="mn-login__dev-banner-title">Local development build</span>
            <p className="mn-login__dev-banner-text">
              Sign in with your workforce email and password. A deterministic default local
              administrator can be created with <code>node scripts/local-dev-seed-admin.js</code>
              {' '}(see docs/V1/V1-ADMIN-LOCAL-LOGIN-01.md).
            </p>
          </div>
        )}

        {(!!valError || !!error) && (
          <div className="mn-login__error-box" role="alert" id="admin-login-error">
            {valError || error}
          </div>
        )}

        {!!successMsg && (
          <div className="mn-login__success-box" role="status">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSignIn} className="mn-login__form">
          <div className="mn-login__input-group">
            <label className="mn-login__label" htmlFor="admin-login-email">Email or username</label>
            <input
              id="admin-login-email"
              className="mn-login__input"
              type="text"
              autoComplete="username"
              placeholder="admin@monienaija.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="mn-login__input-group">
            <label className="mn-login__label" htmlFor="admin-login-password">Password</label>
            <input
              id="admin-login-password"
              className="mn-login__input"
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
            className="mn-login__submit-btn"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {DEV_AUTH_MOCK && (
          <div className="mn-login__advanced-section">
            <button
              type="button"
              className="mn-login__advanced-toggle"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? '▲ Hide advanced (engineering) options' : '▼ Advanced: OIDC / Bootstrap (engineering only)'}
            </button>

            {showAdvanced && (
              <div>
                <div className="mn-login__tab-header">
                  <button
                    type="button"
                    className={advancedTab === 'oidc' ? 'mn-login__tab-btn mn-login__tab-btn--active' : 'mn-login__tab-btn'}
                    onClick={() => { setAdvancedTab('oidc'); setValError(''); }}
                  >
                    OIDC Ingress Login
                  </button>
                  <button
                    type="button"
                    className={advancedTab === 'bootstrap' ? 'mn-login__tab-btn mn-login__tab-btn--active' : 'mn-login__tab-btn'}
                    onClick={() => { setAdvancedTab('bootstrap'); setValError(''); }}
                  >
                    Bootstrap Authority
                  </button>
                </div>

                {advancedTab === 'oidc' ? (
                  <form onSubmit={handleOidcLogin} className="mn-login__form">
                    <div className="mn-login__input-group">
                      <label className="mn-login__label" htmlFor="admin-oidc-token">Signed OIDC ID Assertion Token (Compact JWS)</label>
                      <textarea
                        id="admin-oidc-token"
                        className="mn-login__textarea"
                        placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLg"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                    <button type="submit" disabled={isLoading} className="mn-login__submit-btn">
                      {isLoading ? 'Exchanging Session...' : 'Establish Session'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleBootstrap} className="mn-login__form">
                    <div className="mn-login__input-group">
                      <label className="mn-login__label" htmlFor="admin-bootstrap-token">Finance Admin Bootstrap Statement (JWS)</label>
                      <textarea
                        id="admin-bootstrap-token"
                        className="mn-login__textarea"
                        placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLg"
                        value={bootstrapInput}
                        onChange={(e) => setBootstrapInput(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                    <button type="submit" disabled={isLoading} className="mn-login__submit-btn">
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
