import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { WalletController } from '../src/wallet/wallet.controller';
import type { WalletService } from '../src/wallet/wallet.service';

const operator = (scopes: string[]): AuthorizationPrincipal => ({
  type: 'OPERATOR',
  principalId: 'operator',
  roles: [],
  scopes,
  customerAccess: 'NONE',
});

describe('wallet provisioning authorization', () => {
  const auth = new AuthorizationService({} as never, {} as never);
  const createWallet = jest.fn().mockResolvedValue({ id: 'created' });
  const controller = new WalletController({ createWallet } as unknown as WalletService, auth);
  const dto = { customerId: 'customer', currency: 'NGN', idempotencyKey: 'key' };
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(auth, 'authorize')
      .mockImplementation((principal, policy, resource) =>
        Promise.resolve(auth.evaluate(principal, policy, resource)),
      );
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not allow read-only wallet capability to provision', async () => {
    await expect(
      controller.createWallet(dto, undefined, {
        headers: {},
        authorizationPrincipal: operator(['customer.view_wallets']),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createWallet).not.toHaveBeenCalled();
  });
  it('requires a principal and rejects customer and support identities', async () => {
    await expect(controller.createWallet(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    for (const type of ['CUSTOMER', 'SUPPORT'] as const) {
      await expect(
        controller.createWallet(dto, undefined, {
          headers: {},
          authorizationPrincipal: { ...operator(['customer.create_wallet']), type },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(createWallet).not.toHaveBeenCalled();
  });
  it('requires the write capability even for non-read-only workforce', async () => {
    await expect(
      controller.createWallet(dto, undefined, {
        headers: {},
        authorizationPrincipal: operator(['customer.create_wallet']),
      }),
    ).resolves.toEqual({ id: 'created' });
    expect(createWallet).toHaveBeenCalledTimes(1);
  });
});
