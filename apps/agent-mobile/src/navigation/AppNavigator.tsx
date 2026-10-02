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
import { TransactionPinManageScreen } from '../screens/authenticated/pin/TransactionPinManageScreen';
import { SetTransactionPinScreen } from '../screens/authenticated/pin/SetTransactionPinScreen';
import { CashToWalletRecipientScreen } from '../screens/authenticated/cash-in/CashToWalletRecipientScreen';
import { CashToWalletAmountScreen } from '../screens/authenticated/cash-in/CashToWalletAmountScreen';
import { CashToWalletConfirmScreen } from '../screens/authenticated/cash-in/CashToWalletConfirmScreen';
import { CashToWalletSuccessScreen } from '../screens/authenticated/cash-in/CashToWalletSuccessScreen';
import { CashToCashRecipientScreen } from '../screens/authenticated/cash-to-cash/CashToCashRecipientScreen';
import { CashToCashAmountScreen } from '../screens/authenticated/cash-to-cash/CashToCashAmountScreen';
import { CashToCashConfirmScreen } from '../screens/authenticated/cash-to-cash/CashToCashConfirmScreen';
import { CashToCashSuccessScreen } from '../screens/authenticated/cash-to-cash/CashToCashSuccessScreen';
import { CashToCashClaimRecipientScreen } from '../screens/authenticated/cash-to-cash/CashToCashClaimRecipientScreen';
import { CashToCashClaimConfirmScreen } from '../screens/authenticated/cash-to-cash/CashToCashClaimConfirmScreen';
import { CashToCashClaimSuccessScreen } from '../screens/authenticated/cash-to-cash/CashToCashClaimSuccessScreen';
import { WalletToCashRecipientScreen } from '../screens/authenticated/cash-out/WalletToCashRecipientScreen';
import { WalletToCashAmountScreen } from '../screens/authenticated/cash-out/WalletToCashAmountScreen';
import { WalletToCashConfirmScreen } from '../screens/authenticated/cash-out/WalletToCashConfirmScreen';
import { WalletToCashSuccessScreen } from '../screens/authenticated/cash-out/WalletToCashSuccessScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Foundation navigation (spec §8):
 *  - loading session restore → Splash
 *  - pending mandatory credential rotation → RotateCredential ONLY
 *  - unauthenticated → Login
 *  - authenticated → Home + Account + Transactions/History + PIN Management + Cash→Wallet + Cash→Cash + Wallet→Cash + Cash→Cash Claim
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
            name="TransactionPinManage"
            component={TransactionPinManageScreen}
            options={{ title: 'Transaction PIN' }}
          />
          <Stack.Screen
            name="SetTransactionPin"
            component={SetTransactionPinScreen}
            options={({ route }) => ({
              title: route.params?.mode === 'ROTATE' ? 'Change PIN' : 'Set PIN',
            })}
          />
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
          <Stack.Screen
            name="CashToCash"
            component={CashToCashRecipientScreen}
            options={{ title: 'Cash→Cash' }}
          />
          <Stack.Screen
            name="CashToCashAmount"
            component={CashToCashAmountScreen}
            options={{ title: 'Amount' }}
          />
          <Stack.Screen
            name="CashToCashConfirm"
            component={CashToCashConfirmScreen}
            options={{ title: 'Confirm & Authorize', headerBackVisible: false }}
          />
          <Stack.Screen
            name="CashToCashSuccess"
            component={CashToCashSuccessScreen}
            options={{ title: 'Cash→Cash Complete', headerBackVisible: false }}
          />
          <Stack.Screen
            name="CashToCashClaim"
            component={CashToCashClaimRecipientScreen}
            options={{ title: 'Cash→Cash Claim' }}
          />
          <Stack.Screen
            name="CashToCashClaimConfirm"
            component={CashToCashClaimConfirmScreen}
            options={{ title: 'Confirm Claim', headerBackVisible: false }}
          />
          <Stack.Screen
            name="CashToCashClaimSuccess"
            component={CashToCashClaimSuccessScreen}
            options={{ title: 'Claim Complete', headerBackVisible: false }}
          />
          <Stack.Screen
            name="WalletToCash"
            component={WalletToCashRecipientScreen}
            options={{ title: 'Wallet→Cash' }}
          />
          <Stack.Screen
            name="WalletToCashAmount"
            component={WalletToCashAmountScreen}
            options={{ title: 'Amount' }}
          />
          <Stack.Screen
            name="WalletToCashConfirm"
            component={WalletToCashConfirmScreen}
            options={{ title: 'Confirm & Authorize', headerBackVisible: false }}
          />
          <Stack.Screen
            name="WalletToCashSuccess"
            component={WalletToCashSuccessScreen}
            options={{ title: 'Cash-out Complete', headerBackVisible: false }}
          />
        </>
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;
