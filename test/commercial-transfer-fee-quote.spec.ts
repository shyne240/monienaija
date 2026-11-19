import type { LedgerService } from '../src/ledger/ledger.service';
import type { CommercialAccountingRegistryService } from '../src/commercial-accounting/commercial-accounting-registry.service';
import { CommercialAccountingConfigService } from '../src/commercial-accounting/commercial-accounting-config.service';
import { CommercialAccountingService } from '../src/commercial-accounting/commercial-accounting.service';
import { CommercialVatTreatment } from '../src/commercial-accounting/commercial-accounting.enums';

describe('commercial transfer fee debit quote', () => {
  const config = new CommercialAccountingConfigService();
  const service = new CommercialAccountingService(
    {} as LedgerService,
    config,
    {} as CommercialAccountingRegistryService,
  );
  const fee = { status: 'APPLIED', feeMinor: '100', vatMinor: '7', ruleRefs: [{ vatBps: 750 }] };
  afterEach(() => jest.restoreAllMocks());
  it('uses the same exclusive accounting split as the posting path', () => {
    jest.spyOn(config, 'read').mockReturnValue({
      enabled: true,
      vatTreatment: CommercialVatTreatment.EXCLUSIVE_ADD_ON,
      commissionTreatment: null,
      commissionTiming: null,
    });
    expect(service.quoteFeeDebit(fee)).toEqual({
      feeMinor: '100',
      vatMinor: '7',
      debitMinor: '107',
    });
  });
  it('separates inclusive VAT without charging it twice', () => {
    jest.spyOn(config, 'read').mockReturnValue({
      enabled: true,
      vatTreatment: CommercialVatTreatment.INCLUSIVE_IN_FEE,
      commissionTreatment: null,
      commissionTiming: null,
    });
    expect(service.quoteFeeDebit(fee)).toEqual({
      feeMinor: '94',
      vatMinor: '6',
      debitMinor: '100',
    });
  });
  it('does not promise a configured charge when accounting, VAT treatment or rate is unavailable', () => {
    const read = jest.spyOn(config, 'read');
    read.mockReturnValue({
      enabled: false,
      vatTreatment: null,
      commissionTreatment: null,
      commissionTiming: null,
    });
    expect(() => service.quoteFeeDebit(fee)).toThrow('cannot be quoted');
    read.mockReturnValue({
      enabled: true,
      vatTreatment: null,
      commissionTreatment: null,
      commissionTiming: null,
    });
    expect(() => service.quoteFeeDebit(fee)).toThrow('VAT treatment');
    read.mockReturnValue({
      enabled: true,
      vatTreatment: CommercialVatTreatment.EXCLUSIVE_ADD_ON,
      commissionTreatment: null,
      commissionTiming: null,
    });
    expect(() => service.quoteFeeDebit({ ...fee, ruleRefs: [{ vatBps: null }] })).toThrow(
      'VAT rate',
    );
    expect(() => service.quoteFeeDebit({ ...fee, vatMinor: '8' })).toThrow('recomputation');
  });
  it('refuses ambiguity and preserves the existing no-rule or explicit-zero fee semantics', () => {
    expect(() =>
      service.quoteFeeDebit({ status: 'NOT_CONFIGURED', resolutionStatus: 'AMBIGUOUS' }),
    ).toThrow('ambiguous');
    expect(service.quoteFeeDebit({ status: 'NOT_CONFIGURED' })).toEqual({
      feeMinor: '0',
      vatMinor: '0',
      debitMinor: '0',
    });
    expect(service.quoteFeeDebit({ status: 'ZERO' })).toEqual({
      feeMinor: '0',
      vatMinor: '0',
      debitMinor: '0',
    });
  });
});
