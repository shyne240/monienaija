import React, { useRef, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { DEV_AUTH_MOCK } from '../../config';
import '../../design-system/tokens.css';
import './login.css';

export const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [bootstrapInput, setBootstrapInput] = useState('');
  const [advancedTab, setAdvancedTab] = useState<'oidc' | 'bootstrap'>('oidc');
  const [valError, setValError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [invalidField, setInvalidField] = useState<'email' | 'password' | 'oidc' | 'bootstrap' | null>(null);
  const [activeAction, setActiveAction] = useState<'password' | 'oidc' | 'bootstrap' | null>(null);
  const busyRef = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const oidcRef = useRef<HTMLTextAreaElement>(null);
  const bootstrapRef = useRef<HTMLTextAreaElement>(null);

  const { loginWithPassword, login, bootstrap, isLoading, error, clearError } = useAuthStore();

  const resetFeedback = () => { setValError(''); setInvalidField(null); setSuccessMsg(''); clearError(); };
  const failValidation = (field: 'email' | 'password' | 'oidc' | 'bootstrap', message: string) => {
    setValError(message); setInvalidField(field); setSuccessMsg(''); clearError();
    ({ email: emailRef, password: passwordRef, oidc: oidcRef, bootstrap: bootstrapRef })[field].current?.focus();
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || isLoading) return;
    if (!email.trim() || !password) {
      failValidation(!email.trim() ? 'email' : 'password', 'Email/username and password are required');
      return;
    }
    resetFeedback(); busyRef.current = true; setActiveAction('password');

    try {
      await loginWithPassword(email, password);
      setPassword('');
    } catch {
      // Handled by store
    } finally { busyRef.current = false; setActiveAction(null); }
  };

  const handleOidcLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || isLoading) return;
    if (!tokenInput.trim()) { failValidation('oidc', 'OIDC ID Token is required'); return; }
    resetFeedback(); busyRef.current = true; setActiveAction('oidc');

    try {
      await login(tokenInput);
      setTokenInput('');
    } catch {
      // Handled by store
    } finally { busyRef.current = false; setActiveAction(null); }
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || isLoading) return;
    if (!bootstrapInput.trim()) { failValidation('bootstrap', 'Bootstrap Statement JWS is required'); return; }
    resetFeedback(); busyRef.current = true; setActiveAction('bootstrap');

    try {
      await bootstrap(bootstrapInput);
      setSuccessMsg('Bootstrap statement consumed successfully! You can now log in.');
      setBootstrapInput('');
    } catch {
      // Handled by store
    } finally { busyRef.current = false; setActiveAction(null); }
  };

  return (
    <main className="mn-login mn-login__container">
      <div className="mn-login__shell">
        <section className="mn-login__identity" aria-label="MonieNaija administration">
          <div className="one-login-brand"><span>MonieNaija <em>One</em></span><small>Financial Operations Console</small></div>
          <div className="one-login-message"><span className="one-login-rule" aria-hidden="true" /><p className="one-login-lead">A secure, unified workspace<br />for your financial network</p>
            <ul className="one-login-features">
              <li><span aria-hidden="true">◇</span>Manage customers &amp; agents</li>
              <li><span aria-hidden="true">⇄</span>Oversee transactions &amp; operations</li>
              <li><span aria-hidden="true">⌑</span>Control risk, compliance &amp; approvals</li>
              <li><span aria-hidden="true">▥</span>Monitor performance &amp; growth</li>
            </ul>
          </div>
          <div className="one-login-art" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <p className="mn-login__identity-note">Access is governed by your workforce identity and assigned permissions.</p>
        </section>
      <section className="mn-login__card" aria-labelledby="admin-login-title">
        <header className="mn-login__intro"><h1 id="admin-login-title">Welcome back</h1><p>Sign in to your MonieNaija One admin console</p></header>

        {DEV_AUTH_MOCK && (
          <div className="mn-login__dev-banner">
            <span className="mn-login__dev-banner-title">Local development build</span>
            <p className="mn-login__dev-banner-text">
              For a disposable local database, follow the 11-role setup in
              {' '}<code>docs/admin-m2/windows-local-run.md</code>. These accounts are not production credentials.
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
              ref={emailRef} id="admin-login-email"
              aria-invalid={invalidField === 'email' || undefined} aria-describedby={invalidField === 'email' ? 'admin-login-error' : undefined}
              className="mn-login__input"
              type="text"
              autoComplete="username"
              placeholder={DEV_AUTH_MOCK ? 'super-admin@monienaija.local' : 'Workforce email'}
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (invalidField === 'email') { setInvalidField(null); setValError(''); } }}
              disabled={isLoading}
            />
          </div>

          <div className="mn-login__input-group">
            <label className="mn-login__label" htmlFor="admin-login-password">Password</label>
            <div className="one-login-password"><input
              ref={passwordRef} id="admin-login-password"
              aria-invalid={invalidField === 'password' || undefined} aria-describedby={invalidField === 'password' ? 'admin-login-error' : undefined}
              className="mn-login__input"
              type={passwordVisible ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (invalidField === 'password') { setInvalidField(null); setValError(''); } }}
              disabled={isLoading}
            /><button type="button" className="one-login-password-toggle" aria-label={passwordVisible ? 'Hide password' : 'Show password'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)} disabled={isLoading}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="mn-login__submit-btn"
          >
            {isLoading ? activeAction === 'password' ? 'Signing in...' : 'Please wait...' : 'Sign In'} <span aria-hidden="true">→</span>
          </button>
        </form>

        <p className="mn-login__availability">Password sign-in is available only where the local workforce authentication endpoint is enabled.</p>
        {DEV_AUTH_MOCK && (
          <div className="mn-login__advanced-section">
            <button
              type="button"
              className="mn-login__advanced-toggle"
              aria-expanded={showAdvanced}
              aria-controls={showAdvanced ? "admin-advanced-options" : undefined}
              disabled={isLoading}
              onClick={() => { if (showAdvanced) { setTokenInput(''); setBootstrapInput(''); } resetFeedback(); setShowAdvanced((prev) => !prev); }}
            >
              {showAdvanced ? '▲ Hide advanced (engineering) options' : '▼ Advanced: OIDC / Bootstrap (engineering only)'}
            </button>

            {showAdvanced && (
              <div id="admin-advanced-options">
                <p className="mn-login__advanced-note">Local engineering tools. Closing this section or switching tools clears typed assertions.</p>
                <div className="mn-login__tab-header" role="group" aria-label="Advanced authentication tools">
                  <button
                    type="button"
                    className={advancedTab === 'oidc' ? 'mn-login__tab-btn mn-login__tab-btn--active' : 'mn-login__tab-btn'}
                    aria-pressed={advancedTab === 'oidc'} disabled={isLoading}
                    onClick={() => { if (advancedTab !== 'oidc') { setTokenInput(''); setBootstrapInput(''); resetFeedback(); setAdvancedTab('oidc'); } }}
                  >
                    OIDC Ingress Login
                  </button>
                  <button
                    type="button"
                    className={advancedTab === 'bootstrap' ? 'mn-login__tab-btn mn-login__tab-btn--active' : 'mn-login__tab-btn'}
                    aria-pressed={advancedTab === 'bootstrap'} disabled={isLoading}
                    onClick={() => { if (advancedTab !== 'bootstrap') { setTokenInput(''); setBootstrapInput(''); resetFeedback(); setAdvancedTab('bootstrap'); } }}
                  >
                    Bootstrap Authority
                  </button>
                </div>

                {advancedTab === 'oidc' ? (
                  <form onSubmit={handleOidcLogin} className="mn-login__form">
                    <div className="mn-login__input-group">
                      <label className="mn-login__label" htmlFor="admin-oidc-token">Signed OIDC ID Assertion Token (Compact JWS)</label>
                      <textarea
                        ref={oidcRef} id="admin-oidc-token" autoComplete="off" spellCheck={false}
                        aria-invalid={invalidField === 'oidc' || undefined} aria-describedby={invalidField === 'oidc' ? 'admin-login-error' : undefined}
                        className="mn-login__textarea"
                        placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLg"
                        value={tokenInput}
                        onChange={(e) => { setTokenInput(e.target.value); if (invalidField === 'oidc') { setInvalidField(null); setValError(''); } }}
                        disabled={isLoading}
                      />
                    </div>
                    <button type="submit" disabled={isLoading} className="mn-login__submit-btn">
                      {isLoading ? activeAction === 'oidc' ? 'Exchanging Session...' : 'Please wait...' : 'Establish Session'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleBootstrap} className="mn-login__form">
                    <div className="mn-login__input-group">
                      <label className="mn-login__label" htmlFor="admin-bootstrap-token">Finance Admin Bootstrap Statement (JWS)</label>
                      <textarea
                        ref={bootstrapRef} id="admin-bootstrap-token" autoComplete="off" spellCheck={false}
                        aria-invalid={invalidField === 'bootstrap' || undefined} aria-describedby={invalidField === 'bootstrap' ? 'admin-login-error' : undefined}
                        className="mn-login__textarea"
                        placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLg"
                        value={bootstrapInput}
                        onChange={(e) => { setBootstrapInput(e.target.value); if (invalidField === 'bootstrap') { setInvalidField(null); setValError(''); } }}
                        disabled={isLoading}
                      />
                    </div>
                    <button type="submit" disabled={isLoading} className="mn-login__submit-btn">
                      {isLoading ? activeAction === 'bootstrap' ? 'Consuming Statement...' : 'Please wait...' : 'Consume Bootstrap Statement'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </section>
      </div>
    </main>
  );
};
