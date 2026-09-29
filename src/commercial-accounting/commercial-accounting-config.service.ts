import { Injectable } from '@nestjs/common';

import {
  CommercialVatTreatment,
  CommissionAccountingTreatment,
  CommissionRecognitionTiming,
} from './commercial-accounting.enums';

/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — runtime-read accounting configuration.
 *
 * Deliberately read FRESH on every call (never cached at bootstrap): the approved decisions
 * require the selected treatment/timing to be evaluated at runtime, and the operating posture
 * must be able to change without redeploy. Absence of configuration is NEVER coerced into an
 * implicit treatment — the callers fail closed when a decision that needs configuration finds
 * none (DP-03=B / "do not silently treat an unconfigured VAT rate as zero"; DP-15=A atomicity).
 *
 * Master switch: COMMERCIAL_ACCOUNTING_ENABLED. When it is not exactly 'true', this
 * implementation is inert: flows keep their pre-existing evidence-only annotations unchanged
 * (byte-for-byte), so an unconfigured deployment cannot accidentally mutate journals.
 */
export const ACCOUNTING_ENV_KEYS = {
  ENABLED: 'COMMERCIAL_ACCOUNTING_ENABLED',
  VAT_TREATMENT: 'COMMERCIAL_ACCOUNTING_VAT_TREATMENT',
  COMMISSION_TREATMENT: 'COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT',
  COMMISSION_TIMING: 'COMMERCIAL_COMMISSION_RECOGNITION_TIMING',
} as const;

export interface AccountingConfigView {
  enabled: boolean;
  vatTreatment: CommercialVatTreatment | null;
  commissionTreatment: CommissionAccountingTreatment | null;
  commissionTiming: CommissionRecognitionTiming | null;
}

const VALID_VAT_TREATMENTS = new Set<string>(Object.values(CommercialVatTreatment));
const VALID_TREATMENTS = new Set<string>(Object.values(CommissionAccountingTreatment));
const VALID_TIMINGS = new Set<string>(Object.values(CommissionRecognitionTiming));

function readOptional(key: string): string | null {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

@Injectable()
export class CommercialAccountingConfigService {
  /** Present-but-invalid values fail closed at read time (never coerced to a default). */
  read(): AccountingConfigView {
    const enabledRaw = readOptional(ACCOUNTING_ENV_KEYS.ENABLED);
    if (enabledRaw !== null && enabledRaw !== 'true' && enabledRaw !== 'false') {
      throw new Error(
        `${ACCOUNTING_ENV_KEYS.ENABLED} must be 'true' or 'false' when present (got '${enabledRaw}')`,
      );
    }

    const vatTreatment = readOptional(ACCOUNTING_ENV_KEYS.VAT_TREATMENT);
    if (vatTreatment !== null && !VALID_VAT_TREATMENTS.has(vatTreatment)) {
      throw new Error(
        `${ACCOUNTING_ENV_KEYS.VAT_TREATMENT} must be one of ${[...VALID_VAT_TREATMENTS].join('|')} (got '${vatTreatment}')`,
      );
    }

    const commissionTreatment = readOptional(ACCOUNTING_ENV_KEYS.COMMISSION_TREATMENT);
    if (commissionTreatment !== null && !VALID_TREATMENTS.has(commissionTreatment)) {
      throw new Error(
        `${ACCOUNTING_ENV_KEYS.COMMISSION_TREATMENT} must be one of ${[...VALID_TREATMENTS].join('|')} (got '${commissionTreatment}')`,
      );
    }

    const commissionTiming = readOptional(ACCOUNTING_ENV_KEYS.COMMISSION_TIMING);
    if (commissionTiming !== null && !VALID_TIMINGS.has(commissionTiming)) {
      throw new Error(
        `${ACCOUNTING_ENV_KEYS.COMMISSION_TIMING} must be one of ${[...VALID_TIMINGS].join('|')} (got '${commissionTiming}')`,
      );
    }

    return {
      enabled: enabledRaw === 'true',
      vatTreatment: vatTreatment as CommercialVatTreatment | null,
      commissionTreatment: commissionTreatment as CommissionAccountingTreatment | null,
      commissionTiming: commissionTiming as CommissionRecognitionTiming | null,
    };
  }

  isEnabled(): boolean {
    return this.read().enabled;
  }
}
