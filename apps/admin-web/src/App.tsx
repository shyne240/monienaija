import React, { useEffect } from 'react';
import { useAuthStore } from './store/auth-store';
import { LoginScreen } from './screens/unauthenticated/LoginScreen';
import { Layout } from './screens/authenticated/Layout';

export const App: React.FC = () => {
  const { isAuthenticated, isLoading, restoreSession } = useAuthStore();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p style={styles.loadingText}>Initializing MoneyNaija Admin Core...</p>
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
