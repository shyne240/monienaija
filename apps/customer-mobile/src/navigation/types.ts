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
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
