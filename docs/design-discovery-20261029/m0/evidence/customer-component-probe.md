# Customer component probe — source and reproduction

**Evidence, not application code.** This temporary Jest harness rendered Customer Home, Transactions and Profile directly with a mocked API, auth store and navigator. At discovery commit `cf60b9d8001c605f4d986a222c07ed10e7adee30`, Node `v22.22.3`, npm `10.9.8` and Jest `29.7.0`, it produced **1 suite / 8 tests passed**. `--silent` suppresses console output; no warning-free claim is made. It does not mount the actual navigator or run on a device, connect to a backend, validate physical behavior or run VoiceOver/TalkBack.

The scenarios are: wallet with Support; zero wallets and empty history; fresh wallet failure; zero wallets with a recent item; fresh empty Transactions; fresh failed Transactions; history item → `CreateSupportTicket`; and Profile rendered directly → `TransactionPin`. See [interpretation and unknowns](../01-verification.md#customer-profile-transaction-pin-and-support).

To rerun in a checkout with the existing Customer dependencies installed, extract the fenced snippet into a temporary directory **outside the repository** and run Jest from the Customer package. The test data are synthetic. The command does not modify application source or install a dependency:

```sh
REPO="$(git rev-parse --show-toplevel)"
PROBE_DIR="$(mktemp -d)"
awk '/^```js customer-probe$/{p=1;next} /^```$/{if(p) exit} p' \
  "$REPO/docs/design-discovery-20261029/m0/evidence/customer-component-probe.md" \
  > "$PROBE_DIR/customer-navigation.test.js"
cd "$REPO/apps/customer-mobile"
NODE_PATH="$PWD/node_modules" ./node_modules/.bin/jest --runInBand \
  --runTestsByPath "$PROBE_DIR/customer-navigation.test.js" --roots "$PROBE_DIR" --silent
```

```js customer-probe
// Run from the Customer Mobile package directory.
const app = process.cwd();
const React = require(app + '/node_modules/react');
const { render, waitFor, fireEvent, cleanup } = require(app + '/node_modules/@testing-library/react-native');

jest.doMock(app + '/src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn() },
  ApiError: class ApiError extends Error {},
}));
jest.doMock(app + '/src/store/auth-store', () => ({
  useAuthStore: () => ({ customerId: 'synthetic-customer', logout: jest.fn() }),
}));
const mockNavigate = jest.fn();
jest.doMock(app + '/node_modules/@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: jest.fn(),
}));
const { ApiClient } = require(app + '/src/services/api-client');
const { HomeScreen } = require(app + '/src/screens/authenticated/HomeScreen');
const { TransactionsScreen } = require(app + '/src/screens/authenticated/TransactionsScreen');
const { ProfileScreen } = require(app + '/src/screens/authenticated/ProfileScreen');

afterEach(() => { cleanup(); jest.clearAllMocks(); });
const tx = {
  id: 'synthetic-transaction', type:'WALLET_TRANSFER', narration:'Synthetic sample',
  reference:'synthetic-reference', amountMinor:'5000', currency:'NGN', direction:'SENT',
  status:'COMPLETED', createdAt:'2026-01-01T10:00:00Z',
};

test('wallet exists: Home shows Support and See All but no Profile or PIN entry', async () => {
  ApiClient.get.mockImplementation(url => Promise.resolve(url.includes('/wallets') ? [{id:'synthetic-wallet',currency:'NGN',status:'ACTIVE',balanceMinor:'0'}] : {items:[]}));
  const screen=render(React.createElement(HomeScreen));
  await waitFor(()=>expect(screen.getByText('Support')).toBeTruthy());
  expect(screen.getByText('See All')).toBeTruthy();
  expect(screen.queryByText('Profile')).toBeNull();
  expect(screen.queryByText('Transaction PIN')).toBeNull();
  fireEvent.press(screen.getByText('Support'));
  expect(mockNavigate).toHaveBeenCalledWith('Support');
});

test('zero wallets and empty history: no direct Support, Profile, or PIN; See All opens Transactions', async () => {
  ApiClient.get.mockImplementation(url => Promise.resolve(url.includes('/wallets') ? [] : {items:[]}));
  const screen=render(React.createElement(HomeScreen));
  await waitFor(()=>expect(screen.getByText('No Wallet Found')).toBeTruthy());
  expect(screen.queryByText('Support')).toBeNull();
  expect(screen.queryByText('Profile')).toBeNull();
  expect(screen.queryByText('Transaction PIN')).toBeNull();
  fireEvent.press(screen.getByText('See All'));
  expect(mockNavigate).toHaveBeenCalledWith('Transactions');
});

test('wallet request failure from fresh Home: error and no-wallet view show; direct Support absent', async () => {
  ApiClient.get.mockImplementation(url => url.includes('/wallets') ? Promise.reject(new Error('Synthetic wallet error')) : Promise.resolve({items:[]}));
  const screen=render(React.createElement(HomeScreen));
  await waitFor(()=>expect(screen.getByText('Synthetic wallet error')).toBeTruthy());
  expect(screen.getByText('No Wallet Found')).toBeTruthy();
  expect(screen.queryByText('Support')).toBeNull();
  expect(screen.getByText('See All')).toBeTruthy();
});

test('no-wallet Home with a recent item still has no direct Get help or Support button', async () => {
  ApiClient.get.mockImplementation(url => Promise.resolve(url.includes('/wallets') ? [] : {items:[tx]}));
  const screen=render(React.createElement(HomeScreen));
  await waitFor(()=>expect(screen.getByText('No Wallet Found')).toBeTruthy());
  expect(screen.getByText('See All')).toBeTruthy();
  expect(screen.queryByText('Support')).toBeNull();
  expect(screen.queryByText('Get help')).toBeNull();
});

test('fresh empty Transactions has no contextual Get help action', async () => {
  ApiClient.get.mockResolvedValue({items:[]});
  const screen=render(React.createElement(TransactionsScreen));
  await waitFor(()=>expect(screen.getByText('No transaction records found.')).toBeTruthy());
  expect(screen.queryByText('Get help')).toBeNull();
});

test('fresh failed Transactions shows an error alongside empty text, without contextual Get help', async () => {
  ApiClient.get.mockRejectedValue(new Error('Synthetic history error'));
  const screen=render(React.createElement(TransactionsScreen));
  await waitFor(()=>expect(screen.getByText('Failed to load transactions.')).toBeTruthy());
  expect(screen.getByText('No transaction records found.')).toBeTruthy();
  expect(screen.queryByText('Get help')).toBeNull();
});

test('a history item exposes Get help -> CreateSupportTicket, not the Support list', async () => {
  ApiClient.get.mockResolvedValue({items:[tx]});
  const screen=render(React.createElement(TransactionsScreen));
  await waitFor(()=>expect(screen.getByText('Get help')).toBeTruthy());
  fireEvent.press(screen.getByText('Get help'));
  expect(mockNavigate).toHaveBeenCalledWith('CreateSupportTicket', expect.any(Object));
});

test('Profile rendered directly contains the Transaction PIN link', async () => {
  ApiClient.get.mockImplementation(url => Promise.resolve(url === '/customers/me' ? {reference:'synthetic',type:'INDIVIDUAL',status:'ACTIVE',kycLevel:'NONE',kycStatus:'NOT_STARTED'} : url.endsWith('/limits') ? {products:[]} : {profile:{displayName:'Synthetic'}}));
  const screen=render(React.createElement(ProfileScreen));
  await waitFor(()=>expect(screen.getByText('Transaction PIN')).toBeTruthy());
  fireEvent.press(screen.getByText('Transaction PIN'));
  expect(mockNavigate).toHaveBeenCalledWith('TransactionPin');
});
```
