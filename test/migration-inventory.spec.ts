import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ARENA 4 Phase 4 — complete migration inventory.
 *
 * The production readiness check now compares the loaded migration inventory with the applied
 * rows, so a skipped EARLIER id fails closed. This test pins the repository side of that contract:
 * the institutional chain is present, identifiers are unique and ordered, and the intentionally
 * absent unfinished Arena 1 identifiers are neither fabricated nor renumbered.
 */
function repositoryMigrations(): Array<{ timestamp: string; name: string; file: string }> {
  return readdirSync(join(__dirname, '..', 'src', 'migrations'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const base = file.replace(/\.ts$/, '');
      const separator = base.indexOf('-');
      const timestamp = base.slice(0, separator);
      const name = `${base.slice(separator + 1)}${timestamp}`;
      return { timestamp, name, file };
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

describe('migration inventory', () => {
  const migrations = repositoryMigrations();

  it('contains the complete published institutional chain in order', () => {
    const institutional = [
      '1785753600400',
      '1785753600401',
      '1785753600500',
      '1785753600501',
      '1785753600502',
      '1785753600503',
      '1785753600504',
      '1785753600505',
    ];
    const timestamps = migrations.map((migration) => migration.timestamp);
    for (const timestamp of institutional) expect(timestamps).toContain(timestamp);
    const positions = institutional.map((timestamp) => timestamps.indexOf(timestamp));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('never renumbers or duplicates a published identifier', () => {
    const timestamps = migrations.map((migration) => migration.timestamp);
    expect(new Set(timestamps).size).toBe(timestamps.length);
    expect(timestamps).toEqual([...timestamps].sort());
  });

  it('adopts the published Arena 2 range and the Arena 1 financial engine range', () => {
    const timestamps = new Set(migrations.map((migration) => migration.timestamp));
    // ARENA 1/Arena 2 consolidation (Stage 3-5): the governed ledger reversal `0117` and the A6/A7
    // financial-engine migrations `0140`-`0146` now ship with their published identifiers. Arena 4's
    // customer credential recovery adds `0402` inside its allocated institutional range. They are all
    // adopted as published and never renumbered or duplicated.
    for (const id of [117, 140, 141, 142, 143, 144, 145, 146, 402]) {
      expect(timestamps.has(`1785753600${id}`)).toBe(true);
    }
    for (const id of [120, 130, 131, 132, 200, 201, 202, 203, 204, 205]) {
      expect(timestamps.has(`1785753600${id}`)).toBe(true);
    }
    // The adjacent published migrations that the supported upgrade path does use remain present.
    expect(timestamps.has('1785753600116')).toBe(true);
    expect(timestamps.has('1785753600118')).toBe(true);
  });

  it('ends at the settlement-report reconciliation migration after the Banking identities', () => {
    // The consolidated chain carries both frozen branches: Arena 3D appended 0606-0614 after the
    // banking range, Arena 2C appended 0800-0802 after that, Arena 5 appended 0803–0804 for the
    // dual-lane (customer/agent) A6 financial authorization + external-ops, Arena 1 appended
    // 0805 (customer classes), PR #23 appended 0806 (durable inbound identity) and 0807
    // (captured customer funding scope), PR #33 appended 0813 (Platform Funds vs. Bank Balance).
    // Two independent candidates then extend the tail in timestamp order without renumbering:
    // the Monnify Banking journey (0900) and its governed return refunds (0901), then Arena 10's
    // settlement-report reconciliation (0910). The head is pinned exactly — a head-only allowance
    // would let a skipped earlier identity pass.
    expect(migrations.at(-1)).toMatchObject({
      timestamp: '1785753600910',
      name: 'SettlementReportReconciliation1785753600910',
    });
    expect(migrations.at(-2)).toMatchObject({
      timestamp: '1785753600901',
      name: 'BankToWalletReturnRefunds1785753600901',
    });
    expect(migrations.at(-3)).toMatchObject({
      timestamp: '1785753600900',
      name: 'BankToWalletMonnifyJourney1785753600900',
    });
    expect(migrations.at(-4)).toMatchObject({
      timestamp: '1785753600813',
      name: 'CreatePlatformFundsBankComparisons1785753600813',
    });
    expect(migrations.at(-5)).toMatchObject({
      timestamp: '1785753600812',
      name: 'CustomerRestrictionConfigurationReview1785753600812',
    });
    expect(migrations.at(-6)).toMatchObject({
      timestamp: '1785753600811',
      name: 'LimitRuleUnlimited1785753600811',
    });
    expect(migrations.at(-7)).toMatchObject({
      timestamp: '1785753600810',
      name: 'CustomerTierDefaultClassMappings1785753600810',
    });
    expect(migrations.at(-8)).toMatchObject({
      timestamp: '1785753600807',
      name: 'CaptureCustomerFundingScope1785753600807',
    });
    expect(migrations.at(-9)).toMatchObject({
      timestamp: '1785753600806',
      name: 'DurableInboundIdentity1785753600806',
    });
    expect(migrations.at(-10)).toMatchObject({
      timestamp: '1785753600805',
      name: 'CreateCustomerClasses1785753600805',
    });
    expect(migrations.at(-11)).toMatchObject({
      timestamp: '1785753600804',
      name: 'GeneralizeExternalOperationsForAgents1785753600804',
    });
  });

  it('preserves the KYC identity revision migration after the banking chain moved the tail', () => {
    expect(migrations.find((migration) => migration.timestamp === '1785753600505')).toMatchObject({
      name: 'KycIdentityRevisionAndEvidenceRead1785753600505',
    });
  });

  it('contains the banking chain in order within the allocated range', () => {
    const banking = migrations
      .filter((migration) => migration.timestamp.startsWith('17857536006'))
      // `1785753600606` onward are ARENA 3D groups appended after the banking range, not part of the
      // banking chain. The original assertion covered the whole `17857536006xx` prefix because nothing else
      // was allocated there yet; scoping it to the reserved 600–605 window keeps the original guarantee
      // (banking ids are contiguous and never renumbered) without asserting that no later migration may
      // exist. A genuine gap or renumbering inside 600–605 still fails.
      .filter((migration) => Number(migration.timestamp.slice(-3)) <= 605)
      .map((migration) => migration.timestamp);
    // Contiguous and ordered: 600..605, the allocation reserved for banking. A gap would mean an
    // identifier was skipped or renumbered, which the production readiness check treats as failure.
    expect(banking).toEqual([
      '1785753600600',
      '1785753600601',
      '1785753600602',
      '1785753600603',
      '1785753600604',
      '1785753600605',
    ]);
  });

  it('contains the Arena 3D appended identities 0606-0614 in order', () => {
    // ARENA 3D appended these after the banking range. They are required published identities:
    // they are never renumbered, rewritten or dropped, and no gap is permitted inside the range
    // even though they are not part of the contiguous 0600-0605 banking allocation.
    const arena3d = [
      ['1785753600606', 'OutboxLeasesAndDeadLetters1785753600606'],
      ['1785753600607', 'IntegritySnapshots1785753600607'],
      ['1785753600608', 'EmergencyAccessReviewRequirement1785753600608'],
      ['1785753600609', 'FraudRiskSignals1785753600609'],
      ['1785753600610', 'ComplianceRegister1785753600610'],
      ['1785753600611', 'ComplaintsAndDisputes1785753600611'],
      ['1785753600612', 'MobileClientSupport1785753600612'],
      ['1785753600613', 'NotificationDeliveryReceipts1785753600613'],
      ['1785753600614', 'PrivacyAndRetention1785753600614'],
    ] as const;
    const byTimestamp = new Map(
      migrations.map((migration) => [migration.timestamp, migration.name]),
    );
    for (const [timestamp, name] of arena3d) {
      expect(byTimestamp.get(timestamp)).toBe(name);
    }
    const positions = arena3d.map(([timestamp]) =>
      migrations.findIndex((migration) => migration.timestamp === timestamp),
    );
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('contains the appended identities 0800-0813 after the Arena 3D range in order', () => {
    // Arena 2C appended 0800-0802 after the Arena 3D range (wallet-transfer quote binding,
    // agent verified-phone proof, typed beneficiary ownership), Arena 5 appended 0803–0804
    // (dual-lane financial authorization + external-operations generalisation), and Arena 1
    // appended 0805 (customer classes). Each identity is published and is never renumbered.
    const appended = [
      ['1785753600800', 'BindWalletTransferQuotes1785753600800'],
      ['1785753600801', 'AgentVerifiedPhone1785753600801'],
      ['1785753600802', 'ExtendBeneficiaryOwnership1785753600802'],
      ['1785753600803', 'GeneralizeFinancialAuthorizationsForAgents1785753600803'],
      ['1785753600804', 'GeneralizeExternalOperationsForAgents1785753600804'],
      ['1785753600805', 'CreateCustomerClasses1785753600805'],
      ['1785753600806', 'DurableInboundIdentity1785753600806'],
      ['1785753600807', 'CaptureCustomerFundingScope1785753600807'],
      ['1785753600810', 'CustomerTierDefaultClassMappings1785753600810'],
      ['1785753600811', 'LimitRuleUnlimited1785753600811'],
      ['1785753600812', 'CustomerRestrictionConfigurationReview1785753600812'],
      ['1785753600813', 'CreatePlatformFundsBankComparisons1785753600813'],
    ] as const;
    const byTimestamp = new Map(
      migrations.map((migration) => [migration.timestamp, migration.name]),
    );
    for (const [timestamp, name] of appended) {
      expect(byTimestamp.get(timestamp)).toBe(name);
    }
    const last3d = migrations.findIndex((migration) => migration.timestamp === '1785753600614');
    const first2c = migrations.findIndex((migration) => migration.timestamp === '1785753600800');
    expect(first2c).toBeGreaterThan(last3d);
  });

  it('contains the complete published migration inventory', () => {
    // The consolidated inventory is the union of the two frozen branches: 152 common identities
    // (151 byte-identical plus one formatted 3D copy), nine appended by Arena 3D, three by
    // Arena 2C, two by Arena 5 (agent financial authorization + external-ops), the additive
    // fee-targeting migration contributed by PR #4 (0506), the Prembly credential-governance
    // migration (0507), the customer-class migration contributed by Arena 1 (0805), the durable
    // inbound identity (0806), captured customer funding scope (0807), the tier-default
    // configuration migrations (0810-0812), the platform-funds bank comparisons migration
    // contributed by PR #33 (0813), the Monnify Bank→Wallet journey (0900) and its governed
    // return refunds (0901), and the settlement-report reconciliation migration contributed by
    // Arena 10 (0910). Any additional or missing file fails this assertion.
    expect(migrations).toContainEqual({
      timestamp: '1785753600506',
      name: 'FeeRuleTargeting1785753600506',
      file: '1785753600506-FeeRuleTargeting.ts',
    });
    expect(migrations).toContainEqual({
      timestamp: '1785753600507',
      name: 'PremblyKycCredentialGovernance1785753600507',
      file: '1785753600507-PremblyKycCredentialGovernance.ts',
    });
    expect(migrations).toContainEqual({
      timestamp: '1785753600805',
      name: 'CreateCustomerClasses1785753600805',
      file: '1785753600805-CreateCustomerClasses.ts',
    });
    for (const [timestamp, name, file] of [
      [
        '1785753600810',
        'CustomerTierDefaultClassMappings1785753600810',
        '1785753600810-CustomerTierDefaultClassMappings.ts',
      ],
      ['1785753600811', 'LimitRuleUnlimited1785753600811', '1785753600811-LimitRuleUnlimited.ts'],
      [
        '1785753600812',
        'CustomerRestrictionConfigurationReview1785753600812',
        '1785753600812-CustomerRestrictionConfigurationReview.ts',
      ],
      [
        '1785753600813',
        'CreatePlatformFundsBankComparisons1785753600813',
        '1785753600813-CreatePlatformFundsBankComparisons.ts',
      ],
    ] as const) {
      expect(migrations).toContainEqual({ timestamp, name, file });
    }
    expect(migrations).toContainEqual({
      timestamp: '1785753600900',
      name: 'BankToWalletMonnifyJourney1785753600900',
      file: '1785753600900-BankToWalletMonnifyJourney.ts',
    });
    expect(migrations).toContainEqual({
      timestamp: '1785753600901',
      name: 'BankToWalletReturnRefunds1785753600901',
      file: '1785753600901-BankToWalletReturnRefunds.ts',
    });
    expect(migrations).toContainEqual({
      timestamp: '1785753600910',
      name: 'SettlementReportReconciliation1785753600910',
      file: '1785753600910-SettlementReportReconciliation.ts',
    });
    expect(migrations.length).toBe(178);
  });

  it('orders the adopted Arena 2 evidence migrations before the institutional chain', () => {
    const timestamps = migrations.map((migration) => migration.timestamp);
    const arena2 = [
      '1785753600205',
      '1785753600400',
      '1785753600503',
      '1785753600504',
      '1785753600505',
    ];
    const positions = arena2.map((timestamp) => timestamps.indexOf(timestamp));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    // A newly adopted lower-numbered migration must never be inserted after a higher published
    // one in file order: the supported upgrade applies them in timestamp order.
    expect(timestamps).toEqual([...timestamps].sort());
  });
});
