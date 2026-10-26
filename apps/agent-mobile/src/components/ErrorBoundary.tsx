import React, { Component, ErrorInfo, ReactNode } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';

import { theme } from '../theme';
import { ErrorState } from './ErrorState';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <ErrorState
            message={this.state.error?.message || 'An unexpected layout error occurred.'}
            title="Application Error"
            onRetry={this.handleReset}
            retryLabel="Reload Screen"
          />
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
});
export default ErrorBoundary;
