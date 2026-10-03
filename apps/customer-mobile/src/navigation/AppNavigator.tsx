import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { theme } from '../theme';
import { RootStackParamList } from './types';
import { useAuthStore } from '../store/auth-store';

// Import Screens
import { SplashScreen } from '../screens/unauthenticated/SplashScreen';
import { WelcomeScreen } from '../screens/unauthenticated/WelcomeScreen';
import { LoginScreen } from '../screens/unauthenticated/LoginScreen';
import { RegistrationScreen } from '../screens/unauthenticated/RegistrationScreen';

import { HomeScreen } from '../screens/authenticated/HomeScreen';
import { SendMoneyScreen } from '../screens/authenticated/SendMoneyScreen';
import { TransactionsScreen } from '../screens/authenticated/TransactionsScreen';
import { ProfileScreen } from '../screens/authenticated/ProfileScreen';
import { TransactionPinScreen } from '../screens/authenticated/TransactionPinScreen';
import { SupportScreen } from '../screens/authenticated/SupportScreen';
import { CreateSupportTicketScreen } from '../screens/authenticated/CreateSupportTicketScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.primary.main,
        },
        headerTintColor: theme.colors.neutral.white,
        headerTitleStyle: {
          fontWeight: theme.typography.weights.bold,
        },
        contentStyle: {
          backgroundColor: theme.colors.neutral.offWhite,
        },
      }}
    >
      {!isAuthenticated ? (
        // Unauthenticated Stack
        <>
          <Stack.Screen
            name="Welcome"
            component={WelcomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ title: 'Log In' }}
          />
          <Stack.Screen
            name="Registration"
            component={RegistrationScreen}
            options={{ title: 'Create Wallet' }}
          />
        </>
      ) : (
        // Authenticated Stack
        <>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'MoneyNaija' }}
          />
          <Stack.Screen
            name="SendMoney"
            component={SendMoneyScreen}
            options={{ title: 'Send Money' }}
          />
          <Stack.Screen
            name="Transactions"
            component={TransactionsScreen}
            options={{ title: 'Transaction History' }}
          />
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ title: 'Profile' }}
          />
          <Stack.Screen
            name="TransactionPin"
            component={TransactionPinScreen}
            options={{ title: 'Transaction PIN' }}
          />
          <Stack.Screen
            name="Support"
            component={SupportScreen}
            options={{ title: 'Support' }}
          />
          <Stack.Screen
            name="CreateSupportTicket"
            component={CreateSupportTicketScreen}
            options={{ title: 'New Ticket' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
};
export default AppNavigator;
