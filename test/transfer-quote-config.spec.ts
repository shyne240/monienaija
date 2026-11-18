import { validateEnvironment } from '../src/config/environment';
import { walletTransferQuoteTtlSeconds } from '../src/transfer/transfer-quote.service';

const base = {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_NAME: 'test',
  DB_USER: 'test',
  DB_PASSWORD: 'test-password',
};

describe('wallet transfer quote lifetime configuration', () => {
  it('validates bounded integer values without supplying a production policy', () => {
    expect(validateEnvironment(base).WALLET_TRANSFER_QUOTE_TTL_SECONDS).toBeUndefined();
    expect(
      validateEnvironment({ ...base, WALLET_TRANSFER_QUOTE_TTL_SECONDS: '90' })
        .WALLET_TRANSFER_QUOTE_TTL_SECONDS,
    ).toBe(90);
    for (const value of ['0', '-1', '1.5', '86401', 'NaN'])
      expect(() =>
        validateEnvironment({ ...base, WALLET_TRANSFER_QUOTE_TTL_SECONDS: value }),
      ).toThrow(/WALLET_TRANSFER_QUOTE_TTL_SECONDS/);
  });
  it('only defaults in development/test and fails closed elsewhere when unset', () => {
    for (const NODE_ENV of ['development', 'test'])
      expect(walletTransferQuoteTtlSeconds(undefined, NODE_ENV)).toBe(300);
    for (const NODE_ENV of ['staging', 'production'])
      expect(() => walletTransferQuoteTtlSeconds(undefined, NODE_ENV)).toThrow(/not configured/);
    expect(walletTransferQuoteTtlSeconds(120, 'production')).toBe(120);
    for (const value of [0, -1, 1.2, 86401, 'garbage'])
      expect(() => walletTransferQuoteTtlSeconds(value, 'production')).toThrow(/invalid/);
  });
});
