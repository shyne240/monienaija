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
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
