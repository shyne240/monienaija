import type { ResolvedRecipientView, AgentCashInResult } from '../services/agent-api';

export type RootStackParamList = {
  // Unauthenticated screens
  Splash: undefined;
  Login: undefined;
  RotateCredential: undefined;

  // Authenticated screens (foundation placeholders per spec §8)
  Home: undefined;
  Account: undefined;
  Transactions: undefined;
  History: undefined;

  // Agent Cash→Wallet (V1-AGENT-MOBILE-04). PIN NEVER travels in params.
  CashToWallet: undefined;
  CashToWalletAmount: {
    recipient: ResolvedRecipientView;
    amountMinor?: string;
  };
  CashToWalletConfirm: {
    recipient: ResolvedRecipientView;
    amountMinor: string;
    idempotencyKey: string;
  };
  CashToWalletSuccess: {
    result: AgentCashInResult;
    amountMinor: string;
  };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
