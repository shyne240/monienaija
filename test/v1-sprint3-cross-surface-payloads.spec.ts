/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * ARENA 3 Sprint 3 FINAL INTEGRATION — Phase 7 cross-surface verification.
 *
 * Validates the EXACT payload shapes serialized by Agent Mobile's typed API client
 * (apps/agent-mobile/src/services/agent-api.ts + CashToCashConfirmScreen /
 * CashToCashClaimConfirmScreen call sites, ARENA 2 commit 3ace151) against the real
 * backend runtime validation (class-validator DTOs, ARENA 1 commit e81f5f7 and the
 * pre-existing UUID claim DTO). This closes the gap between the separately-mocked
 * frontend tests and backend tests: the JSON that leaves the mobile app must satisfy
 * the same validators that run behind the global ValidationPipe.
 *
 * Serializer behavior replicated here exactly as shipped:
 * - initiation: { senderPhone, beneficiaryPhone, amountMinor, currency:'NGN',
 *   idempotencyKey, agentPin } — optional reference/description/correlationId/metadata
 *   omitted by the confirm screen.
 * - claim-by-number: agentCashToCashClaimByNumber() trims senderPhone/transferNumber,
 *   strips any stray transferId, and the confirm screen sends transferCode.trim(),
 *   otp.trim(), redemptionMethod ALWAYS (state is one of the two literals), and
 *   agentPin (untrimmed secret) ONLY for AGENT_CASH.
 * - recover-by-number: { senderPhone, transferNumber, idempotencyKey } — original key.
 * - legacy UUID claim: same fields as claim-by-number plus transferId.
 *
 * No real browser/device is involved; this is runtime DTO validation of the serialized
 * shapes, complementing the HTTP-level PostgreSQL suites (a15/a16/a17) that exercise the
 * same routes end-to-end.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CashToCashClaimDto,
  CashToCashLocatorClaimDto,
  CashToCashLocatorRecoveryDto,
} from '../src/agent/dto/cash-to-cash-claim.dto';
import { CashToCashDto } from '../src/agent/dto/cash-to-cash.dto';

// The mobile ValidationPipe-equivalent options: the app uses
// new ValidationPipe({ whitelist: true, transform: true }) globally (src/main.ts pattern
// replicated by every HTTP integration suite in this repo).
const pipeOptions = { whitelist: true, transform: true };

async function validateDto<T extends object>(cls: new () => T, payload: unknown): Promise<string[]> {
  const instance = plainToInstance(cls, payload as object);
  const errors = await validate(instance as object, pipeOptions);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('Sprint 3 Phase 7 — Agent Mobile serialized payloads satisfy backend runtime validation', () => {
  it('accepts the exact initiation payload from CashToCashConfirmScreen', async () => {
    // agentCashToCash({ senderPhone, beneficiaryPhone, amountMinor, currency:'NGN',
    //   idempotencyKey: effectiveKeyRef.current, agentPin: pin }) — spread verbatim.
    const mobileSerialized = JSON.parse(
      JSON.stringify({
        senderPhone: '08031234567',
        beneficiaryPhone: '08035556677',
        amountMinor: '2000',
        currency: 'NGN',
        idempotencyKey: 'mobile-send-key-0001',
        agentPin: '123456',
      }),
    );
    expect(await validateDto(CashToCashDto, mobileSerialized)).toEqual([]);
  });

  it('rejects initiation payloads missing the now-required senderPhone', async () => {
    const legacyShape = {
      beneficiaryPhone: '08035556677',
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: 'mobile-send-key-0002',
      agentPin: '123456',
    };
    const messages = await validateDto(CashToCashDto, legacyShape);
    expect(messages.some((m) => /senderPhone/.test(m))).toBe(true);
  });

  it('accepts the exact CUSTOMER_WALLET claim-by-number payload from CashToCashClaimConfirmScreen', async () => {
    // Post-serializer shape: senderPhone/transferNumber trimmed by
    // agentCashToCashClaimByNumber(), transferId stripped, code/otp trimmed by the screen,
    // redemptionMethod always present, agentPin omitted for CUSTOMER_WALLET.
    const mobileSerialized = JSON.parse(
      JSON.stringify({
        senderPhone: '+2348031234567'.trim(),
        transferNumber: ' 000042 '.trim(),
        beneficiaryPhone: '08035556677',
        transferCode: ' 12345678 '.trim(),
        customerId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        mfaChallengeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
        otp: ' 654321 '.trim(),
        idempotencyKey: 'mobile-claim-key-0001',
        redemptionMethod: 'CUSTOMER_WALLET',
      }),
    );
    expect(mobileSerialized.transferNumber).toBe('000042'); // leading zeros preserved as text
    expect(await validateDto(CashToCashLocatorClaimDto, mobileSerialized)).toEqual([]);
  });

  it('accepts the exact AGENT_CASH claim-by-number payload (untrimmed agentPin secret included)', async () => {
    const mobileSerialized = JSON.parse(
      JSON.stringify({
        senderPhone: '8031234567',
        transferNumber: '099999',
        beneficiaryPhone: '08035556677',
        transferCode: '12345678',
        customerId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        mfaChallengeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
        otp: '654321',
        idempotencyKey: 'mobile-claim-key-0002',
        redemptionMethod: 'AGENT_CASH',
        agentPin: ' 9876 ', // the screen deliberately does NOT trim the PIN secret
      }),
    );
    expect(await validateDto(CashToCashLocatorClaimDto, mobileSerialized)).toEqual([]);
  });

  it('rejects a stray transferId on claim-by-number (mobile serializer strips it; backend must too)', async () => {
    const withTransferId = {
      senderPhone: '8031234567',
      transferNumber: '000042',
      beneficiaryPhone: '08035556677',
      transferCode: '12345678',
      customerId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      mfaChallengeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
      otp: '654321',
      idempotencyKey: 'mobile-claim-key-0003',
      redemptionMethod: 'CUSTOMER_WALLET',
      transferId: '3f2504e0-4f89-11d3-9a0c-0305e82c3303',
    };
    const messages = await validateDto(CashToCashLocatorClaimDto, withTransferId);
    expect(messages.some((m) => /transferId/.test(m))).toBe(true);
  });

  it('rejects non-six-character-string transfer numbers the mobile screen already blocks client-side', async () => {
    const base = {
      senderPhone: '8031234567',
      beneficiaryPhone: '08035556677',
      transferCode: '12345678',
      customerId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      mfaChallengeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
      otp: '654321',
      idempotencyKey: 'mobile-claim-key-0004',
      redemptionMethod: 'CUSTOMER_WALLET',
    };
    for (const transferNumber of ['42', '0000422', '00004a', 42 as unknown as string]) {
      const messages = await validateDto(CashToCashLocatorClaimDto, { ...base, transferNumber });
      expect(messages.some((m) => /transferNumber/.test(m))).toBe(true);
    }
  });

  it('accepts the exact recover-by-number payload from pending-operation recovery', async () => {
    const mobileSerialized = JSON.parse(
      JSON.stringify({
        senderPhone: '08031234567'.trim(),
        transferNumber: '000042',
        idempotencyKey: 'mobile-claim-key-0001', // ORIGINAL claim key, never a fresh one
      }),
    );
    expect(await validateDto(CashToCashLocatorRecoveryDto, mobileSerialized)).toEqual([]);
  });

  it('accepts the exact legacy UUID claim payload kept for historical transfers', async () => {
    const mobileSerialized = JSON.parse(
      JSON.stringify({
        transferId: '3f2504e0-4f89-11d3-9a0c-0305e82c3303',
        beneficiaryPhone: '08035556677',
        transferCode: '12345678',
        customerId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        mfaChallengeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
        otp: '654321',
        idempotencyKey: 'mobile-claim-key-0005',
        redemptionMethod: 'AGENT_CASH',
        agentPin: '9876',
      }),
    );
    expect(await validateDto(CashToCashClaimDto, mobileSerialized)).toEqual([]);
  });
});
