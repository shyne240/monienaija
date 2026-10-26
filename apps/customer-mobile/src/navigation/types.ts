export type RootStackParamList = {
  // Unauthenticated screens
  Splash: undefined;
  Welcome: undefined;
  Login: undefined;
  Registration: undefined;

  // Authenticated screens
  Home: undefined;
  SendMoney: undefined;
  Transactions: undefined;
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
