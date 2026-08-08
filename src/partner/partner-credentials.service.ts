import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';

import type { Environment } from '../config/environment';
import type { PartnerEnvironment, PartnerKey } from './partner-adapter.types';
import {
  type PartnerCredentialKind,
  type PartnerCredentialReference,
  type PartnerConnectionProfile,
} from './partner-connection.types';

export const PARTNER_CREDENTIAL_LOADER = Symbol('PARTNER_CREDENTIAL_LOADER');

export interface PartnerCredentialLoader {
  loadReferences(profile: PartnerConnectionProfile): {
    credentialReference: PartnerCredentialReference;
    signingKeyReference: PartnerCredentialReference;
  };
}

export class PartnerConfigurationException extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PartnerConfigurationException';
  }
}

@Injectable()
export class EnvironmentPartnerCredentialLoader implements PartnerCredentialLoader {
  constructor(private readonly configService: ConfigService) {}

  loadReferences(profile: PartnerConnectionProfile): {
    credentialReference: PartnerCredentialReference;
    signingKeyReference: PartnerCredentialReference;
  } {
    const credentialReference = this.reference(
      profile.partnerKey,
      profile.environment,
      'CLIENT_AUTHENTICATION',
      this.valueForEnvironment(
        profile.environment,
        'A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE',
        'A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE',
      ),
    );
    const signingKeyReference = this.reference(
      profile.partnerKey,
      profile.environment,
      'REQUEST_SIGNING',
      this.valueForEnvironment(
        profile.environment,
        'A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE',
        'A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE',
      ),
    );
    return { credentialReference, signingKeyReference };
  }

  private reference(
    partnerKey: PartnerKey,
    environment: PartnerEnvironment,
    kind: PartnerCredentialKind,
    value: string | undefined,
  ): PartnerCredentialReference {
    if (!value) {
      const code =
        kind === 'REQUEST_SIGNING' ? 'SIGNING_REFERENCE_MISSING' : 'CREDENTIAL_REFERENCE_MISSING';
      throw new PartnerConfigurationException(
        code,
        `The ${kind.toLowerCase()} reference is not configured for the selected A6 partner environment`,
      );
    }
    return { partnerKey, environment, kind, reference: value };
  }

  private valueForEnvironment(
    environment: PartnerEnvironment,
    sandboxKey: keyof Environment,
    productionKey: keyof Environment,
  ): string | undefined {
    const key = environment === 'sandbox' ? sandboxKey : productionKey;
    return this.configService.get<string>(key) || undefined;
  }
}
