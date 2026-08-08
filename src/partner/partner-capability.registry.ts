import { ConflictException, Injectable } from '@nestjs/common';

import {
  EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION,
  EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY,
  NIBSS_NIP_PARTNER_KEY,
  OUTBOUND_BANK_SETTLEMENT_OPERATION,
  type PartnerCapabilityQueryV1,
  type PartnerCapabilityRegistration,
} from './partner-adapter.types';

export const NIBSS_NIP_WITHDRAWAL_SETTLEMENT_CAPABILITY: PartnerCapabilityRegistration =
  Object.freeze({
    partnerKey: NIBSS_NIP_PARTNER_KEY,
    capabilityKey: EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY,
    operationType: OUTBOUND_BANK_SETTLEMENT_OPERATION,
    supportedCurrencies: ['NGN'] as const,
    supportedTargetTypes: ['BANK_ACCOUNT'] as const,
    environments: ['sandbox', 'production'] as const,
    adapterVersion: `a6-adapter-${EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION}`,
    partnerApiVersion: 'v1',
  });

@Injectable()
export class PartnerCapabilityRegistry {
  private readonly registrations = [NIBSS_NIP_WITHDRAWAL_SETTLEMENT_CAPABILITY] as const;

  list(): readonly PartnerCapabilityRegistration[] {
    return this.registrations;
  }

  getRegistration(
    partnerKey: PartnerCapabilityQueryV1['partnerKey'],
    capabilityKey: PartnerCapabilityQueryV1['capabilityKey'],
    operationType: PartnerCapabilityQueryV1['operationType'],
  ): PartnerCapabilityRegistration {
    const registration = this.registrations.find(
      (candidate) =>
        candidate.partnerKey === partnerKey &&
        candidate.capabilityKey === capabilityKey &&
        candidate.operationType === operationType,
    );
    if (!registration) {
      throw new ConflictException('The A6 partner capability is not registered');
    }
    return registration;
  }

  assertCompatible(
    partnerKey: PartnerCapabilityQueryV1['partnerKey'],
    capabilityKey: PartnerCapabilityQueryV1['capabilityKey'],
    operationType: PartnerCapabilityQueryV1['operationType'],
    currency: string,
  ): PartnerCapabilityRegistration {
    const registration = this.getRegistration(partnerKey, capabilityKey, operationType);
    if (!registration.supportedCurrencies.includes(currency as 'NGN')) {
      throw new ConflictException('The A6 partner capability does not support the currency');
    }
    return registration;
  }
}
