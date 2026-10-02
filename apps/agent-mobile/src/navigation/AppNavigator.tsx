import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { theme } from '../theme';
import { RootStackParamList } from './types';
import { useAuthStore } from '../store/auth-store';

import { SplashScreen } from '../screens/unauthenticated/SplashScreen';
import { LoginScreen } from '../screens/unauthenticated/LoginScreen';
import { RotateCredentialScreen } from '../screens/unauthenticated/RotateCredentialScreen';

import { HomeScreen } from '../screens/authenticated/HomeScreen';
import { AccountScreen } from '../screens/authenticated/AccountScreen';
import { TransactionsScreen } from '../screens/authenticated/TransactionsScreen';
import { TransactionReceiptScreen } from '../screens/authenticated/TransactionReceiptScreen';
import { CashToWalletRecipientScreen } from '../screens/authenticated/cash-in/CashToWalletRecipientScreen';
import { CashToWalletAmountScreen } from '../screens/authenticated/cash-in/CashToWalletAmountScreen';
import { CashToWalletConfirmScreen } from '../screens/authenticated/cash-in/CashToWalletConfirmScreen';
import { CashToWalletSuccessScreen } from '../screens/authenticated/cash-in/CashToWalletSuccessScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Foundation navigation (spec §8):
 *  - loading session restore → Splash
 *  - pending mandatory credential rotation → RotateCredential ONLY
 *  - unauthenticated → Login
 *  - authenticated → Home + Account + clearly-labelled placeholders for the
 *    later Transactions/History phases.
 */
export const AppNavigator: React.FC = () => {
  const { isAuthenticated, isLoading, pendingRotation } = useAuthStore();

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
        headerStyle: { backgroundColor: theme.colors.primary.main },
        headerTintColor: theme.colors.neutral.white,
        headerTitleStyle: { fontWeight: theme.typography.weights.bold },
        contentStyle: { backgroundColor: theme.colors.neutral.offWhite },
      }}
    >
      {pendingRotation ? (
        <Stack.Screen
          name="RotateCredential"
          component={RotateCredentialScreen}
          options={{ title: 'Set Your New Password', headerBackVisible: false }}
        />
      ) : !isAuthenticated ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ title: 'Agent Log In', headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'MoneyNaija Agent' }} />
          <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Agent Account' }} />
          <Stack.Screen
            name="Transactions"
            component={TransactionsScreen}
            options={{ title: 'Transaction History' }}
          />
          <Stack.Screen
            name="History"
            component={TransactionsScreen}
            options={{ title: 'Transaction History' }}
          />
          <Stack.Screen
            name="TransactionReceipt"
            component={TransactionReceiptScreen}
            options={{ title: 'Transaction Receipt' }}
          />
          <Stack.Screen
            name="CashToWallet"
            component={CashToWalletRecipientScreen}
            options={{ title: 'Cash→Wallet' }}
          />
          <Stack.Screen
            name="CashToWalletAmount"
            component={CashToWalletAmountScreen}
            options={{ title: 'Amount' }}
          />
          <Stack.Screen
            name="CashToWalletConfirm"
            component={CashToWalletConfirmScreen}
            options={{ title: 'Confirm & Authorize', headerBackVisible: false }}
          />
          <Stack.Screen
            name="CashToWalletSuccess"
            component={CashToWalletSuccessScreen}
            options={{ title: 'Cash→Wallet Complete', headerBackVisible: false }}
          />
        </>
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;
