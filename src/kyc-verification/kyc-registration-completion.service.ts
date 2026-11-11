import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import type { AuditService } from '../operations/audit.service';
import { Customer } from '../customer/customer.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import {
  ContactMethodType,
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
} from '../customer/customer.enums';
import {
  isValidCustomerName,
  isValidEmailAddress,
  normalizeCustomerText,
  normalizeEmailAddress,
} from '../customer/customer-validation';
import type { KycRegistrationSessionService } from './kyc-registration-session.service';
import { constantTimeMacEqual, identityBindingMac, UUID } from './kyc-orchestrator';
import { KycFoundationError } from './kyc.types';

type View = { customerId: string; status: 'DRAFT'; kind: 'BVN' | 'NIN'; simulated: true };
/** Only synthetic fixture attempts, only in an independently isolated socket-only test DB. */
export class KycRegistrationCompletionService {
  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
    private readonly sessions: KycRegistrationSessionService,
  ) {}
  private async assertDisposable(m: EntityManager): Promise<void> {
    const options = this.db.options;
    if (
      !this.sessions.simulationAvailable() ||
      options.type !== 'postgres' ||
      typeof options.host !== 'string' ||
      !/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(options.host) ||
      options.username !== 'kyc_synthetic' ||
      typeof options.database !== 'string' ||
      !/^kyc_batch2_[a-f0-9]{32}$/.test(options.database)
    )
      throw new KycFoundationError('DISABLED');
    const rows = await m.query<
      Array<{
        db: string;
        username: string;
        address: string | null;
        listen: string;
        directory: string;
        version: string;
      }>
    >(
      `SELECT current_database() AS db,current_user AS username,inet_server_addr()::text AS address,current_setting('listen_addresses') AS listen,current_setting('data_directory') AS directory,current_setting('server_version') AS version`,
    );
    const r = rows[0];
    if (
      !r ||
      r.db !== options.database ||
      r.username !== 'kyc_synthetic' ||
      r.address !== null ||
      r.listen !== '' ||
      !/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(r.directory) ||
      !r.version.startsWith('16.')
    )
      throw new KycFoundationError('DISABLED');
  }
  async complete(sessionId: string, authorization: string, attemptId: string): Promise<View> {
    if (
      !UUID.test(sessionId) ||
      !UUID.test(attemptId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(authorization)
    )
      throw new KycFoundationError('BLOCKED');
    try {
      return await this.db.transaction(async (m) => {
        await this.assertDisposable(m);
        const sessions = await m.query<Array<{ phone: string; verified_at: Date }>>(
          `SELECT phone,verified_at FROM kyc_registration_sessions WHERE id=$1 AND authorization_hash=$2 AND status='VERIFIED' AND verified_at IS NOT NULL AND expires_at>clock_timestamp() FOR UPDATE`,
          [sessionId, createHash('sha256').update(authorization).digest('hex')],
        );
        const session = sessions[0];
        if (!session) throw new KycFoundationError('BLOCKED');
        const attempts = await m.query<
          Array<{
            id: string;
            consent_id: string;
            kind: 'BVN' | 'NIN';
            identity_mac: string;
            fixture_hash: string;
          }>
        >(
          `SELECT a.id,a.consent_id,a.kind,b.identity_mac,b.fixture_hash FROM kyc_registration_attempts a JOIN kyc_registration_synthetic_attempt_bindings b ON b.attempt_id=a.id WHERE a.id=$1 AND a.session_id=$2 AND a.state='MATCH' AND a.provider='SYNTHETIC' FOR UPDATE OF a`,
          [attemptId, sessionId],
        );
        const attempt = attempts[0];
        if (!attempt) throw new KycFoundationError('BLOCKED');
        const consents = await m.query<Array<{ id: string }>>(
          `SELECT id FROM kyc_registration_consents WHERE id=$1 AND session_id=$2 AND kind=$3 AND notice_version='synthetic-test-v1' AND withdrawn_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,
          [attempt.consent_id, sessionId, attempt.kind],
        );
        if (!consents[0]) throw new KycFoundationError('BLOCKED');
        const profiles = await m.query<
          Array<{
            first_name: string;
            last_name: string;
            date_of_birth: string;
            email: string | null;
          }>
        >(
          `SELECT first_name,last_name,date_of_birth::text,email FROM kyc_registration_synthetic_profiles WHERE session_id=$1 FOR UPDATE`,
          [sessionId],
        );
        const p = profiles[0];
        if (!p) throw new KycFoundationError('BLOCKED');
        const key = createHmac('sha256', authorization).update('synthetic-request-v1').digest();
        const identity = {
          firstName: p.first_name,
          lastName: p.last_name,
          dateOfBirth: p.date_of_birth,
          phone: `+234${session.phone}`,
        };
        if (
          !constantTimeMacEqual(attempt.identity_mac, identityBindingMac(sessionId, identity, key))
        )
          throw new KycFoundationError('CONFLICT');
        const existing = await m.query<
          Array<{ customer_id: string; attempt_id: string; kind: 'BVN' | 'NIN' }>
        >(
          'SELECT customer_id,attempt_id,kind FROM kyc_registration_synthetic_customer_links WHERE session_id=$1',
          [sessionId],
        );
        if (existing[0]) {
          if (existing[0].attempt_id !== attemptId) throw new KycFoundationError('CONFLICT');
          return {
            customerId: existing[0].customer_id,
            status: 'DRAFT' as const,
            kind: existing[0].kind,
            simulated: true as const,
          };
        }
        if (
          !isValidCustomerName(p.first_name, 100) ||
          !isValidCustomerName(p.last_name, 100) ||
          (p.email && !isValidEmailAddress(p.email))
        )
          throw new KycFoundationError('INVALID');
        const customerId = randomUUID();
        const customers = m.getRepository(Customer);
        await customers.save(
          customers.create({
            id: customerId,
            reference: `mn-synthetic-${randomUUID()}`,
            type: CustomerType.INDIVIDUAL,
            status: CustomerStatus.DRAFT,
            isSynthetic: true,
            kycLevel: CustomerKycLevel.NONE,
            kycStatus: CustomerKycStatus.NOT_STARTED,
            version: 1,
            deletedAt: null,
          }),
        );
        const first = normalizeCustomerText(p.first_name),
          last = normalizeCustomerText(p.last_name);
        const profilesRepo = m.getRepository(CustomerProfile);
        await profilesRepo.save(
          profilesRepo.create({
            id: randomUUID(),
            customerId,
            firstName: first,
            lastName: last,
            middleName: null,
            displayName: `${first} ${last}`,
            legalName: `${first} ${last}`,
            dateOfBirth: p.date_of_birth,
            nationality: null,
            isActive: true,
            deletedAt: null,
          }),
        );
        const contacts = m.getRepository(CustomerContactMethod);
        await contacts.save(
          contacts.create({
            id: randomUUID(),
            customerId,
            type: ContactMethodType.PHONE,
            value: `+234${session.phone}`,
            normalizedValue: session.phone,
            isPrimary: true,
            verifiedAt: session.verified_at,
            deletedAt: null,
          }),
        );
        if (p.email)
          await contacts.save(
            contacts.create({
              id: randomUUID(),
              customerId,
              type: ContactMethodType.EMAIL,
              value: normalizeEmailAddress(p.email),
              normalizedValue: normalizeEmailAddress(p.email),
              isPrimary: true,
              verifiedAt: null,
              deletedAt: null,
            }),
          );
        await m.query(
          `INSERT INTO kyc_registration_synthetic_customer_links(session_id,attempt_id,customer_id,kind,fixture_hash,provider,match_outcome) VALUES($1,$2,$3,$4,$5,'SYNTHETIC','MATCH')`,
          [sessionId, attemptId, customerId, attempt.kind, attempt.fixture_hash],
        );
        await m.query(
          `INSERT INTO kyc_registration_private_audit(id,session_id,resource_id,action) VALUES($1,$2,$3,'SYNTHETIC_DRAFT_CREATED')`,
          [randomUUID(), sessionId, customerId],
        );
        await this.audit.record(m, {
          entityType: 'CUSTOMER',
          entityId: customerId,
          action: 'CREATED',
          actor: 'SYNTHETIC_REGISTRATION',
          newValues: {
            status: 'DRAFT',
            synthetic: true,
            kycLevel: 'NONE',
            kycStatus: 'NOT_STARTED',
          },
        });
        return {
          customerId,
          status: 'DRAFT' as const,
          kind: attempt.kind,
          simulated: true as const,
        };
      });
    } catch (e) {
      if (e instanceof QueryFailedError && (e.driverError as { code?: string }).code === '23505')
        throw new KycFoundationError('CONFLICT');
      throw e;
    }
  }
}
