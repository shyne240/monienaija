import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerStatus } from '../customer/customer.enums';
import { CustomerWalletService } from '../customer-wallet/customer-wallet.service';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { AuditService } from '../operations/audit.service';
import { CustomerActivationReadinessService } from '../customer-onboarding/customer-activation-readiness.service';
import { WalletService } from '../wallet/wallet.service';

const CURRENCY = 'NGN';
/** Raw `customers.status` is read as text; keep the equality target a plain string. */
const ACTIVE_STATUS: string = CustomerStatus.ACTIVE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,255}$/;

/**
 * Customer-owned activation.
 *
 * This closes the gap where a customer could satisfy every verification requirement and still
 * never obtain a usable wallet: previously the only wallet-provisioning surfaces were
 *   - `POST /wallets` (workforce `customer.create_wallet`), and
 *   - `POST /customers/:id/wallets` (P1.4 registry, workforce),
 * both privileged, while `GET /customers/me/wallets` was read-only.
 *
 * Authority model:
 *   - The caller must be an authenticated CUSTOMER SELF principal (checked here AND by the route
 *     policy `customers/me/*` → CUSTOMER SELF), so a customer can only activate their own record.
 *   - All gating is delegated to the authoritative services:
 *       * `CustomerFinancialEligibilityService.require()` — the same gate every money movement
 *         uses (APPROVED current assessment at the customer's tier, live trusted evidence bound to
 *         the current identity revision, exactly one verified primary phone, no manual hold, no
 *         ownership conflict, no FROZEN/BLACKLISTED restriction, approved policy in force);
 *       * `CustomerWalletService.ensurePrimaryWalletInManager()` — the P1.4 provisioning rules
 *         (COMPLETED onboarding + ELIGIBLE eligibility);
 *       * `WalletService.createWalletInTransaction()` — the canonical financial wallet + ledger
 *         account, with its advisory lock and idempotency-key uniqueness.
 *   - The customer must already be `ACTIVE`. This endpoint does not activate a customer: lifecycle
 *     activation remains a governed workforce transition (`PATCH /customers/:id`, `customer.activate`)
 *     so an administrator can never claim a customer self-activated a record they did not verify.
 *   - Nothing here writes credentials or PINs and nothing returns credential material.
 *
 * Atomicity: the P1.4 wallet, the financial wallet and the idempotency audit all run inside ONE
 * `SERIALIZABLE` transaction with bounded retry on serialization failures. A failure at any step
 * leaves no partial wallet.
 *
 * Idempotency: the caller supplies an `Idempotency-Key`. The derived financial-wallet creation key
 * is deterministic (`customer-activation:<customerId>:<currency>`), so a retry converges on the
 * same wallet instead of provisioning a second one; `replayed: true` is reported when nothing new
 * was created.
 */
export interface CustomerWalletActivationResult {
  customerId: string;
  activated: boolean;
  replayed: boolean;
  currency: string;
  wallet: {
    /** Canonical financial wallet id (safe to expose to its owner). */
    walletId: string;
    /** P1.4 provisioning record id. */
    provisioningWalletId: string;
    currency: string;
    status: string;
    /** Short-lived cache hint only; balances are always read from the ledger. */
    balanceHint: 'LEDGER_DERIVED';
  };
  checks: {
    customerActive: boolean;
    verifiedPrimaryPhone: boolean;
    onboardingCompleted: boolean;
    eligibility: string;
    /** Verified KYC tier the financial gate approved this customer at (e.g. `LEVEL_1`). */
    verifiedTier: string;
    financialEligibility: string;
  };
  activatedAt: string;
}

@Injectable()
export class CustomerWalletActivationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly readiness: CustomerActivationReadinessService,
    private readonly customerWallets: CustomerWalletService,
    private readonly walletService: WalletService,
    private readonly financialEligibility: CustomerFinancialEligibilityService,
    private readonly audit: AuditService,
  ) {}

  /** Read-only projection of the customer's own activation state. */
  async view(principal: AuthorizationPrincipal | undefined) {
    const customerId = this.requireSelf(principal);
    const snapshot = await this.readiness.evaluateOuter(customerId);
    const wallets = await this.dataSource.query<
      Array<{ id: string; currency: string; status: string }>
    >(
      `SELECT id,currency,status FROM wallet_accounts
        WHERE lower(customer_id)=lower($1) ORDER BY created_at,id`,
      [customerId],
    );
    return {
      customerId,
      customerStatus: snapshot.customerStatus,
      kyc: snapshot.kyc,
      customerClass: snapshot.customerClass,
      financialEligibility: snapshot.financialEligibility.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
      onboardingWorkflow: snapshot.onboardingWorkflow,
      requirements: snapshot.requirements.map(({ code, label, state, detail }) => ({
        code,
        label,
        state,
        ...(detail ? { detail } : {}),
      })),
      outstanding: snapshot.outstanding,
      activatable: snapshot.activatable,
      wallet: snapshot.wallet.provisioned
        ? {
            walletId: snapshot.wallet.walletId,
            currency: snapshot.wallet.currency,
            status: snapshot.wallet.status,
          }
        : null,
      wallets: wallets.map((wallet) => ({
        id: wallet.id,
        currency: wallet.currency,
        status: wallet.status,
      })),
      evaluatedAt: snapshot.evaluatedAt,
    };
  }

  async activate(
    principal: AuthorizationPrincipal | undefined,
    idempotencyKey: string | undefined,
  ): Promise<CustomerWalletActivationResult> {
    const customerId = this.requireSelf(principal);
    const key = (idempotencyKey ?? '').trim();
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw new ConflictException(
        'An Idempotency-Key header (8-255 safe characters) is required for activation',
      );
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.execute(manager, customerId, key),
        );
      } catch (error) {
        if (isRetryable(error) && attempt < 2) continue;
        if (isRetryable(error)) {
          throw new ConflictException(
            'Activation is temporarily contended; retry with the same Idempotency-Key',
          );
        }
        throw error;
      }
    }
    throw new ConflictException('Activation is temporarily contended; retry');
  }

  private async execute(
    manager: EntityManager,
    customerId: string,
    idempotencyKey: string,
  ): Promise<CustomerWalletActivationResult> {
    const customers = await manager.query<
      Array<{ id: string; status: string; is_synthetic: boolean; deleted_at: Date | null }>
    >('SELECT id,status,is_synthetic,deleted_at FROM customers WHERE id=$1 FOR UPDATE', [
      customerId,
    ]);
    const customer = customers[0];
    if (!customer || customer.deleted_at) throw new NotFoundException('Customer not found');
    if (customer.is_synthetic) {
      throw new ForbiddenException('Disposable test customers cannot be activated');
    }
    if (customer.status !== ACTIVE_STATUS) {
      throw new ConflictException(
        'Account activation by MonieNaija is required before a wallet can be provisioned',
      );
    }

    // Authoritative financial gate, inside this transaction, after the customer row lock.
    // `require()` returns the *verified tier* the customer is eligible at, not a verdict: reaching
    // this line at all means the gate passed, so the verdict is the constant 'ELIGIBLE'.
    let verifiedTier: string;
    try {
      verifiedTier = await this.financialEligibility.require(manager, customerId);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new ConflictException(
          `Wallet provisioning is blocked: ${error.message}. No wallet was created.`,
        );
      }
      throw error;
    }

    // P1.4 provisioning record. This enforces COMPLETED onboarding + ELIGIBLE eligibility.
    let provisioning: {
      wallet: { id: string; currency: string; status: string };
      created: boolean;
    };
    try {
      provisioning = await this.customerWallets.ensurePrimaryWalletInManager(manager, customerId, {
        currency: CURRENCY,
        actor: 'CUSTOMER_ACTIVATION',
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new ConflictException(
          `Wallet provisioning is blocked: ${error.message}. No wallet was created.`,
        );
      }
      throw error;
    }

    // Canonical financial wallet. `createWalletInTransaction` re-runs the eligibility gate, takes
    // the per-owner advisory lock and honours the unique idempotency key.
    const existingCanonical = await manager.query<Array<{ id: string }>>(
      'SELECT id FROM wallet_accounts WHERE lower(customer_id)=lower($1) AND currency=$2 LIMIT 1',
      [customerId, CURRENCY],
    );
    const canonical = await this.walletService.createWalletInTransaction(manager, {
      customerId,
      currency: CURRENCY,
      idempotencyKey: `customer-activation:${customerId}:${idempotencyKey}`.slice(0, 255),
    });
    const replayed = !provisioning.created && existingCanonical.length > 0;
    await this.audit.record(manager, {
      entityType: 'CUSTOMER_WALLET_ACTIVATION',
      entityId: customerId,
      action: replayed ? 'REPLAYED' : 'ACTIVATED',
      actor: customerId,
      newValues: {
        customerId,
        walletId: canonical.id,
        provisioningWalletId: provisioning.wallet.id,
        currency: canonical.currency,
        financialEligibility: 'ELIGIBLE',
        verifiedTier,
        idempotencyKey,
      },
    });

    return {
      customerId,
      activated: true,
      replayed,
      currency: canonical.currency,
      wallet: {
        walletId: canonical.id,
        provisioningWalletId: provisioning.wallet.id,
        currency: canonical.currency,
        status: canonical.status,
        balanceHint: 'LEDGER_DERIVED',
      },
      checks: {
        customerActive: true,
        verifiedPrimaryPhone: true,
        onboardingCompleted: true,
        eligibility: 'ELIGIBLE',
        financialEligibility: 'ELIGIBLE',
        verifiedTier,
      },
      activatedAt: new Date().toISOString(),
    };
  }

  private requireSelf(principal: AuthorizationPrincipal | undefined): string {
    if (!principal) throw new ForbiddenException('Authentication required');
    if (principal.type !== 'CUSTOMER' || !principal.customerId) {
      throw new ForbiddenException('A customer session is required');
    }
    if (!UUID.test(principal.customerId)) {
      throw new ForbiddenException('A customer session is required');
    }
    if (principal.readOnlyPrincipal) {
      throw new ForbiddenException('This session cannot activate an account');
    }
    return principal.customerId;
  }
}

function isRetryable(error: unknown): boolean {
  const code = (error as { driverError?: { code?: string }; code?: string })?.driverError?.code
    ? (error as { driverError: { code?: string } }).driverError.code
    : (error as { code?: string })?.code;
  return code === '40001' || code === '40P01';
}
