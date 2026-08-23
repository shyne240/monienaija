import React from 'react';
import { render } from '@testing-library/react-native';
import { AppNavigator } from '../src/navigation/AppNavigator';
import { useAuthStore } from '../src/store/auth-store';

// Mock navigation components to make it safe to run in node jest tests
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
      const Screen = ({ name, component: Component }: any) => {
        // Return a mock element with custom fields for assertions
        return mockReact.createElement('mock-screen', { name, 'component-name': Component.name || Component.displayName });
      };
      return {
        Navigator,
        Screen,
      };
    },
  };
});

jest.mock('@react-navigation/native', () => {
  return {
    useNavigation: () => ({
      navigate: jest.fn(),
    }),
  };
});

describe('Navigation flow tests', () => {
  test('should render SplashScreen when auth store isLoading is true', () => {
    useAuthStore.setState({
      isLoading: true,
      isAuthenticated: false,
    });

    const { root } = render(<AppNavigator />);
    const screens = root.findAllByType('mock-screen');
    
    expect(screens.length).toBeGreaterThanOrEqual(1);
    expect(screens[0].props.name).toBe('Splash');
  });

  test('should render Unauthenticated stack when user is not authenticated', () => {
    useAuthStore.setState({
      isLoading: false,
      isAuthenticated: false,
    });

    const { root } = render(<AppNavigator />);
    const screens = root.findAllByType('mock-screen');
    
    expect(screens.length).toBeGreaterThanOrEqual(1);
    expect(screens[0].props.name).toBe('Welcome');
  });

  test('should render Authenticated stack when user is authenticated', () => {
    useAuthStore.setState({
      isLoading: false,
      isAuthenticated: true,
    });

    const { root } = render(<AppNavigator />);
    const screens = root.findAllByType('mock-screen');
    
    expect(screens.length).toBeGreaterThanOrEqual(1);
    expect(screens[0].props.name).toBe('Home');
  });
});
