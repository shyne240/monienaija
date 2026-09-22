export type RootStackParamList = {
  // Unauthenticated screens
  Splash: undefined;
  Welcome: undefined;
  Login: undefined;
  Registration: undefined;

  // Authenticated screens
  Home: undefined;
  SendMoney: undefined;
  FundWallet: undefined;
  Withdraw: undefined;
  Transactions: undefined;
  Profile: undefined;
  CreatePin: undefined;
  ChangePin: undefined;
  ResetPin: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
