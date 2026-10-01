import React from 'react';
import { render } from '@testing-library/react-native';
import { AppNavigator } from '../src/navigation/AppNavigator';
import { useAuthStore } from '../src/store/auth-store';

// Render registered screens as named mock elements for route assertions
// (mirrors the customer-mobile navigation test convention).
jest.mock('@react-navigation/native-stack', () => {
  const mockReact = require('react');
  return {
    createNativeStackNavigator: () => {
      const Navigator = ({ children }: any) => {
        const flatten = (nodes: any): any[] => {
          let result: any[] = [];
          mockReact.Children.forEach(nodes, (node: any) => {
            if (!node) return;
            if (node.type === mockReact.Fragment) {
              result = result.concat(flatten(node.props.children));
            } else {
              result.push(node);
            }
          });
          return result;
        };
        return mockReact.createElement(mockReact.Fragment, null, flatten(children));
      };
      const Screen = ({ name, component: Component, children }: any) => {
        const label = Component?.name || Component?.displayName || name;
        return mockReact.createElement('mock-screen', { name, 'component-name': label, hasChildren: !!children });
      };
      return {
        Navigator,
        Screen,
      };
    },
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

describe('AppNavigator routing (foundation)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      session: null,
      agentId: null,
      pendingRotation: null,
      error: null,
    });
  });

  function screenNames() {
    const { root } = render(<AppNavigator />);
    return (root.findAllByType('mock-screen') as any[]).map((s) => s.props.name);
  }

  test('app initialization: session restore keeps the app on the splash route', () => {
    useAuthStore.setState({ isLoading: true });
    expect(screenNames()).toEqual(['Splash']);
  });

  test('unauthenticated: login is the only route', () => {
    expect(screenNames()).toEqual(['Login']);
  });

  test('pending mandatory rotation gates the app onto RotateCredential only', () => {
    useAuthStore.setState({ pendingRotation: { agentId: 'agent-1' } });
    expect(screenNames()).toEqual(['RotateCredential']);
  });

  test('authenticated: home stack; login and rotation routes are removed', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      agentId: 'agent-1',
      session: {
        accessToken: 't',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        agentId: 'agent-1',
        sessionId: 's',
      },
    });
    const names = screenNames();
    expect(names[0]).toBe('Home');
    expect(names).not.toContain('Login');
    expect(names).not.toContain('RotateCredential');
    expect(names).not.toContain('Splash');
  });
});
