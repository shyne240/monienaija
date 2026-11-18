import React, { useEffect, useState } from 'react';
import { useAuthStore } from './store/auth-store';
import { LoginScreen } from './screens/unauthenticated/LoginScreen';
import { Layout } from './screens/authenticated/Layout';

export const App: React.FC = () => {
  const { isAuthenticated, isLoading, restoreSession } = useAuthStore();
  /**
   * The initialising screen is for the **first** paint only, before `restoreSession()` has run.
   *
   * `isLoading` is also true for the duration of every sign-in attempt, and gating on it alone
   * unmounted `LoginScreen` mid-request: a rejected login came back to a blank form, so an
   * operator who mistyped a password had to retype their email as well, and the full-screen
   * "Initializing MonieNaija Admin Core..." replaced the form they were looking at. Found by the
   * Group 33 browser acceptance run (`LOGIN-RETRY-PRESERVES-EMAIL`) and fixed here.
   *
   * The form's own inputs are already disabled while `isLoading`, so the attempt is still not
   * double-submittable.
   */
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    restoreSession();
    setBooted(true);
  }, [restoreSession]);

  if (isLoading && !booted) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p style={styles.loadingText}>Initializing MonieNaija Admin Core...</p>
      </div>
    );
  }

  return isAuthenticated ? <Layout /> : <LoginScreen />;
};

const styles = {
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#F8FAFC',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #E2E8F0',
    borderTop: '4px solid #0A3D25',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    marginTop: '16px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#0A3D25',
  },
};
export default App;
