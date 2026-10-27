import type {
  ResolvedRecipientView,
  ResolvedCustomerRecipientView,
  AgentCashInResult,
  AgentCashOutResult,
  SafeCashToCashResult,
  AgentCashToCashClaimResult,
  SupportTicketCategory,
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

  // Agent Transaction PIN Management (V1-AGENT-MOBILE-10). PINs NEVER travel in params.
  TransactionPinManage: undefined;
  SetTransactionPin: {
    mode: 'CREATE' | 'ROTATE';
  };

  // Agent Support UI (V1-AGENT-MOBILE-11)
  Support: undefined;
  CreateSupportTicket: {
    prefillCategory?: SupportTicketCategory;
    relatedTransferId?: string;
    fundingRequestId?: string;
  } | undefined;
  SupportTicketDetail: {
    ticketId: string;
  };

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

  // Agent Cash→Cash (V1-AGENT-MOBILE-07 + ARENA 1 6-digit locator contract). PIN and transferCode NEVER travel in params.
  CashToCash: undefined;
  CashToCashAmount: {
    senderPhone: string;
    beneficiaryPhone: string;
    amountMinor?: string;
  };
  CashToCashConfirm: {
    senderPhone: string;
    beneficiaryPhone: string;
    amountMinor: string;
    idempotencyKey: string;
  };
  CashToCashSuccess: {
    result: SafeCashToCashResult;
    amountMinor: string;
  };

  // Agent Wallet→Cash Method 1 (V1-AGENT-MOBILE-08). PINs and OTP NEVER travel in params.
  WalletToCash: undefined;
  WalletToCashAmount: {
    customer: ResolvedCustomerRecipientView;
    amountMinor?: string;
  };
  WalletToCashConfirm: {
    customer: ResolvedCustomerRecipientView;
    amountMinor: string;
    idempotencyKey: string;
  };
  WalletToCashSuccess: {
    result: AgentCashOutResult;
    amountMinor: string;
    customerDisplay?: string;
    customerReceivingNumber?: string;
  };

  // Agent Cash→Cash Claim Assist (V1-AGENT-MOBILE-09 + ARENA 1 6-digit locator redemption;
  // legacy UUID transferId variant retained internally for compatibility — NEVER populate transferId with a 6-digit transferNumber).
  // transferCode and OTP NEVER travel in params.
  CashToCashClaim: undefined;
  CashToCashClaimConfirm:
    | {
        customer: ResolvedCustomerRecipientView;
        senderPhone: string;
        transferNumber: string;
        beneficiaryPhone: string;
        transferId?: never;
      }
    | {
        customer: ResolvedCustomerRecipientView;
        transferId: string;
        beneficiaryPhone: string;
        senderPhone?: never;
        transferNumber?: never;
      };
  CashToCashClaimSuccess: {
    result: AgentCashToCashClaimResult;
    customerDisplay?: string;
    customerReceivingNumber?: string;
  };

  // Unified history + history-derived receipt (V1-AGENT-MOBILE-06)
  TransactionReceipt: {
    itemId: string;
    filter?: 'CASH_IN' | 'CASH_OUT' | 'CASH_TO_CASH' | 'CASH_TO_CASH_CLAIM' | 'AGENT_FUNDING' | 'AGENT_DEFUNDING';
  };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
