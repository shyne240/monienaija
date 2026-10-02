import type {
  ResolvedRecipientView,
  AgentCashInResult,
  SafeCashToCashResult,
} from '../services/agent-api';

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

  // Agent Cash→Cash (V1-AGENT-MOBILE-07). PIN and transferCode NEVER travel in params.
  CashToCash: undefined;
  CashToCashAmount: {
    beneficiaryPhone: string;
    amountMinor?: string;
  };
  CashToCashConfirm: {
    beneficiaryPhone: string;
    amountMinor: string;
    idempotencyKey: string;
  };
  CashToCashSuccess: {
    result: SafeCashToCashResult;
    amountMinor: string;
  };

  // Unified history + history-derived receipt (V1-AGENT-MOBILE-06)
  TransactionReceipt: {
    itemId: string;
    filter?: 'CASH_IN' | 'CASH_OUT' | 'CASH_TO_CASH' | 'AGENT_FUNDING' | 'AGENT_DEFUNDING';
  };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
