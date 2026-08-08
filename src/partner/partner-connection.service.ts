import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Environment } from '../config/environment';
import {
  NIBSS_NIP_PARTNER_KEY,
  EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION,
  EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY,
  OUTBOUND_BANK_SETTLEMENT_OPERATION,
  type PartnerCapabilityQueryV1,
  type PartnerCapabilityRegistration,
  type PartnerEnvironment,
} from './partner-adapter.types';
import { PartnerCapabilityRegistry } from './partner-capability.registry';
import {
  PartnerConfigurationException,
  PARTNER_CREDENTIAL_LOADER,
  type PartnerCredentialLoader,
} from './partner-credentials.service';
import { PARTNER_REQUEST_SIGNER } from './partner-request-signing.service';
import type {
  PartnerConnectionBoundary,
  PartnerConnectionContext,
  PartnerConnectionProfile,
  PartnerConnectionStatus,
  PartnerConnectionStatusView,
  PartnerRequestSigner,
  PartnerSigningPreparation,
} from './partner-connection.types';

@Injectable()
export class PartnerConnectionService implements PartnerConnectionBoundary {
  constructor(
    private readonly configService: ConfigService,
    private readonly capabilityRegistry: PartnerCapabilityRegistry,
    @Inject(PARTNER_CREDENTIAL_LOADER)
    private readonly credentialLoader: PartnerCredentialLoader,
    @Inject(PARTNER_REQUEST_SIGNER)
    private readonly requestSigner: PartnerRequestSigner,
  ) {}

  getProfile(): PartnerConnectionProfile {
    const environment = this.read('A6_PARTNER_ENVIRONMENT') ?? 'sandbox';
    const nodeEnvironment = this.read('NODE_ENV') ?? 'development';
    const partnerKey = this.read('A6_PARTNER_KEY') ?? NIBSS_NIP_PARTNER_KEY;
    const capabilityKey =
      this.read('A6_PARTNER_CAPABILITY') ?? EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY;
    const operationType =
      this.read('A6_PARTNER_OPERATION_TYPE') ?? OUTBOUND_BANK_SETTLEMENT_OPERATION;
    const enabled = this.read('A6_PARTNER_ENABLED') ?? false;
    const apiVersion = this.read('A6_PARTNER_API_VERSION') ?? 'v1';
    const adapterVersion =
      this.read('A6_PARTNER_ADAPTER_VERSION') ??
      `a6-adapter-${EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION}`;
    const signingAlgorithm = this.read('A6_PARTNER_SIGNING_ALGORITHM') ?? 'HMAC_SHA256';

    if (environment === 'production' && nodeEnvironment !== 'production') {
      throw new PartnerConfigurationException(
        'PRODUCTION_CONFIGURATION_FORBIDDEN',
        'Production A6 partner configuration requires NODE_ENV=production',
      );
    }

    let registration: PartnerCapabilityRegistration;
    try {
      registration = this.capabilityRegistry.assertCompatible(
        partnerKey,
        capabilityKey,
        operationType,
        'NGN',
      );
    } catch (error) {
      throw new PartnerConfigurationException(
        'CAPABILITY_MISMATCH',
        error instanceof Error ? error.message : 'The A6 partner capability is incompatible',
      );
    }

    const baseUrl = this.endpointFor(environment);
    if (!enabled) {
      return {
        enabled: false,
        nodeEnvironment,
        partnerKey: registration.partnerKey,
        capabilityKey: registration.capabilityKey,
        operationType: registration.operationType,
        environment,
        apiVersion,
        adapterVersion,
        baseUrl,
        credentialReference: null,
        signingKeyReference: null,
        signingAlgorithm,
        requestTimeoutMs: this.read('A6_PARTNER_REQUEST_TIMEOUT_MS') ?? 10_000,
        connectTimeoutMs: this.read('A6_PARTNER_CONNECT_TIMEOUT_MS') ?? 3_000,
      };
    }

    if (!baseUrl) {
      throw new PartnerConfigurationException(
        'NOT_CONFIGURED',
        `The selected A6 ${environment} partner endpoint is not configured`,
      );
    }

    const references = this.credentialLoader.loadReferences({
      enabled,
      nodeEnvironment,
      partnerKey: registration.partnerKey,
      capabilityKey: registration.capabilityKey,
      operationType: registration.operationType,
      environment,
      apiVersion,
      adapterVersion,
      baseUrl,
      credentialReference: null,
      signingKeyReference: null,
      signingAlgorithm,
      requestTimeoutMs: this.read('A6_PARTNER_REQUEST_TIMEOUT_MS') ?? 10_000,
      connectTimeoutMs: this.read('A6_PARTNER_CONNECT_TIMEOUT_MS') ?? 3_000,
    });

    return {
      enabled,
      nodeEnvironment,
      partnerKey: registration.partnerKey,
      capabilityKey: registration.capabilityKey,
      operationType: registration.operationType,
      environment,
      apiVersion,
      adapterVersion,
      baseUrl,
      credentialReference: references.credentialReference,
      signingKeyReference: references.signingKeyReference,
      signingAlgorithm,
      requestTimeoutMs: this.read('A6_PARTNER_REQUEST_TIMEOUT_MS') ?? 10_000,
      connectTimeoutMs: this.read('A6_PARTNER_CONNECT_TIMEOUT_MS') ?? 3_000,
    };
  }

  getStatus(): PartnerConnectionStatusView {
    try {
      const profile = this.getProfile();
      return this.toStatus(profile, profile.enabled ? 'READY_FOR_TRANSPORT' : 'DISABLED');
    } catch (error) {
      const status = this.statusForError(error);
      const profile = this.safeDisabledProfile();
      return this.toStatus(profile, status);
    }
  }

  getCapabilityQuery(
    correlation: PartnerCapabilityQueryV1['correlation'],
  ): PartnerCapabilityQueryV1 {
    const profile = this.getProfile();
    return {
      contractName: 'A6-EXTERNAL-PARTNER-ADAPTER',
      contractVersion: EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION,
      partnerKey: profile.partnerKey,
      capabilityKey: profile.capabilityKey,
      operationType: profile.operationType,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      requestedAt: new Date().toISOString(),
      correlation,
    };
  }

  assertReadyForTransport(): PartnerConnectionContext {
    const profile = this.getProfile();
    if (!profile.enabled) {
      throw new PartnerConfigurationException(
        'PARTNER_DISABLED',
        'The A6 partner capability is disabled and cannot be used for transport',
      );
    }
    if (!profile.credentialReference || !profile.signingKeyReference) {
      throw new PartnerConfigurationException(
        'CREDENTIAL_REFERENCE_MISSING',
        'The A6 partner transport credential references are incomplete',
      );
    }
    return {
      profile,
      credentialReference: profile.credentialReference,
      signingKeyReference: profile.signingKeyReference,
    };
  }

  prepareSigning(
    canonicalPayloadHash: string,
    requestId: string,
    correlationId: string,
    timestamp = new Date().toISOString(),
  ): PartnerSigningPreparation {
    const context = this.assertReadyForTransport();
    return this.requestSigner.prepare({
      partnerKey: context.profile.partnerKey,
      environment: context.profile.environment,
      algorithm: context.profile.signingAlgorithm,
      keyReference: context.signingKeyReference,
      canonicalPayloadHash,
      requestId,
      correlationId,
      timestamp,
    });
  }

  private endpointFor(environment: PartnerEnvironment): string | null {
    return environment === 'sandbox'
      ? (this.read('A6_PARTNER_SANDBOX_BASE_URL') ?? null)
      : (this.read('A6_PARTNER_PRODUCTION_BASE_URL') ?? null);
  }

  private safeDisabledProfile(): PartnerConnectionProfile {
    return {
      enabled: false,
      nodeEnvironment: this.read('NODE_ENV') ?? 'development',
      partnerKey: NIBSS_NIP_PARTNER_KEY,
      capabilityKey: EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY,
      operationType: OUTBOUND_BANK_SETTLEMENT_OPERATION,
      environment: this.read('A6_PARTNER_ENVIRONMENT') ?? 'sandbox',
      apiVersion: this.read('A6_PARTNER_API_VERSION') ?? 'v1',
      adapterVersion:
        this.read('A6_PARTNER_ADAPTER_VERSION') ??
        `a6-adapter-${EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION}`,
      baseUrl: null,
      credentialReference: null,
      signingKeyReference: null,
      signingAlgorithm: this.read('A6_PARTNER_SIGNING_ALGORITHM') ?? 'HMAC_SHA256',
      requestTimeoutMs: this.read('A6_PARTNER_REQUEST_TIMEOUT_MS') ?? 10_000,
      connectTimeoutMs: this.read('A6_PARTNER_CONNECT_TIMEOUT_MS') ?? 3_000,
    };
  }

  private statusForError(error: unknown): PartnerConnectionStatus {
    if (error instanceof PartnerConfigurationException) {
      switch (error.code) {
        case 'PRODUCTION_CONFIGURATION_FORBIDDEN':
          return 'PRODUCTION_CONFIGURATION_FORBIDDEN';
        case 'CAPABILITY_MISMATCH':
          return 'CAPABILITY_MISMATCH';
        case 'CREDENTIAL_REFERENCE_MISSING':
          return 'CREDENTIAL_REFERENCE_MISSING';
        case 'SIGNING_REFERENCE_MISSING':
          return 'SIGNING_REFERENCE_MISSING';
        case 'NOT_CONFIGURED':
          return 'NOT_CONFIGURED';
        default:
          return 'NOT_CONFIGURED';
      }
    }
    return 'NOT_CONFIGURED';
  }

  private toStatus(
    profile: PartnerConnectionProfile,
    status: PartnerConnectionStatus,
  ): PartnerConnectionStatusView {
    return {
      status,
      enabled: profile.enabled,
      partnerKey: profile.partnerKey,
      capabilityKey: profile.capabilityKey,
      operationType: profile.operationType,
      environment: profile.environment,
      apiVersion: profile.apiVersion,
      adapterVersion: profile.adapterVersion,
      baseUrlConfigured: profile.baseUrl !== null,
      credentialReferenceConfigured: profile.credentialReference !== null,
      signingReferenceConfigured: profile.signingKeyReference !== null,
      signingAlgorithm: profile.signingAlgorithm,
      requestTimeoutMs: profile.requestTimeoutMs,
      connectTimeoutMs: profile.connectTimeoutMs,
    };
  }

  private read<K extends keyof Environment>(key: K): Environment[K] | undefined {
    return this.configService.get<Environment[K]>(key);
  }
}
