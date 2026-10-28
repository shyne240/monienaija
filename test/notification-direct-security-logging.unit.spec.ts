/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { CustomerRegistrationService } from '../src/customer-registration/customer-registration.service';
import { AgentDeskOtpService } from '../src/agent/agent-desk-otp.service';
import { AdminCustomerCredentialsController } from '../src/admin/admin-customer-credentials.controller';
import type { NotificationProvider } from '../src/notification/notification.types';

const secretError = 'OTP_SENTINEL PASSWORD_SENTINEL 08012345678 PRIVATE_MESSAGE_SENTINEL';
function failingProvider(throws: boolean): NotificationProvider {
  return {
    name: 'test',
    send: async () => {
      if (throws) throw new Error(secretError);
      return { success: false, error: secretError };
    },
  };
}

describe('direct security notification diagnostics', () => {
  it.each([false, true])('registration failures never log provider text (throws=%s)', async (throws) => {
    const ds = { transaction: async (fn: (manager: unknown) => Promise<void>) => fn({}) };
    const service = new CustomerRegistrationService(ds as never, {} as never, {} as never, failingProvider(throws));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    (service as any).audit = jest.fn().mockResolvedValue(undefined);
    await (service as any).deliverOtpSms({ id: 'challenge', destinationPhone: '08012345678' }, 'OTP_SENTINEL', 'correlation');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/OTP_SENTINEL|PASSWORD_SENTINEL|08012345678|PRIVATE_MESSAGE_SENTINEL/);
    if (throws) expect(warn).toHaveBeenCalled();
  });

  it.each([false, true])('agent desk failures never log provider text (throws=%s)', async (throws) => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'customer', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ value: '08012345678' }])
      .mockResolvedValueOnce([{ id: 'credential' }])
      .mockResolvedValueOnce([{ id: 'enrollment' }])
      .mockResolvedValueOnce([{ id: 'method' }]).mockResolvedValueOnce([]);
    const issuedAt = new Date();
    const service = new AgentDeskOtpService({ query, manager: {} } as never,
      { issueChallenge: async () => ({ id: 'challenge', issuedAt, expiresAt: new Date(issuedAt.getTime() + 300_000) }) } as never,
      { record: async () => undefined } as never, failingProvider(throws));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await service.issue({ customerId: 'customer', agentId: 'agent', purpose: 'WALLET_TO_CASH' });
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/OTP_SENTINEL|PASSWORD_SENTINEL|08012345678|PRIVATE_MESSAGE_SENTINEL/);
  });

  it.each([false, true])('temporary credential failures never log provider text (throws=%s)', async (throws) => {
    const controller = new AdminCustomerCredentialsController({ findOne: async () => ({ value: '08012345678' }) } as never,
      {} as never, {} as never, {} as never, {} as never, failingProvider(throws));
    const warn = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
    (controller as any).recordDeliveryAudit = jest.fn().mockResolvedValue(undefined);
    await (controller as any).deliverTemporaryCredential({ customerId: 'customer', credentialId: 'credential',
      temporaryPassword: 'PASSWORD_SENTINEL', actor: 'actor' });
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/OTP_SENTINEL|PASSWORD_SENTINEL|08012345678|PRIVATE_MESSAGE_SENTINEL/);
  });
});
