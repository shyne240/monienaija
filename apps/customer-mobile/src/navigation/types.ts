export type RootStackParamList = {
  // Unauthenticated screens
  Splash: undefined;
  Welcome: undefined;
  Login: undefined;
  Registration: undefined;

  // Authenticated screens
  Home: undefined;
  SendMoney: undefined;
  // INTEGRATION (integration/main-backend-frontend-20261030): `main` ships FundWalletScreen and
  // WithdrawScreen (and had these two route keys); the backend lineage's navigator never registers
  // them and its own screen set uses the /customers/me/* contract instead. Both screens therefore
  // arrive from `main` as unregistered orphans, which broke `tsc` once the lineage's version of this
  // file won the merge. The keys are restored so the mobile app compiles and nothing from `main` is
  // deleted, but the screens stay unregistered: registering them would surface a customer funding /
  // withdrawal UI whose generic routes (/wallets, /deposits, /withdrawals) are workforce-gated under
  // the authorisation resolution in docs/integration/20261030-CONTROLLED-INTEGRATION-REPORT.md
  // (open item D-01). Registration is the mobile owner's decision once D-01 is settled.
  FundWallet: undefined;
  Withdraw: undefined;
  Transactions: undefined;
  /** ARENA 4: single-transaction details/receipt, backed by GET /customers/me/transactions/:transferId. */
  TransactionDetail: {
    transactionId: string;
    /** Optional list-row preview so the receipt can render while the detail read is in flight. */
    preview?: {
      type?: string | null;
      narration?: string | null;
      reference?: string | null;
      amountMinor?: string | number | null;
      currency?: string;
      status?: string | null;
      createdAt?: string | null;
    };
  };
  /** ARENA 4: verification, tier and limits detail, backed by GET /customers/me/kyc + /me/limits. */
  KycStatus: undefined;
  /** ARENA 4: honest funding entry point (no in-app funding product exists yet). */
  AddMoney: undefined;
  Profile: undefined;
  TransactionPin: undefined;
  Support: undefined;
  CreateSupportTicket:
    | undefined
    | {
        category?: string;
        subject?: string;
        description?: string;
        relatedTransferId?: string;
        fundingRequestId?: string;
      };
  SupportTicketDetail: { ticketId: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
