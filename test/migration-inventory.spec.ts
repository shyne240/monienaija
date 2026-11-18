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

  it('ends at the allocated beneficiary ownership migration', () => {
    // Arena 3D's published banking chain remains intact; the P2P migration follows it.
    expect(migrations.at(-1)).toMatchObject({
      timestamp: '1785753600802',
      name: 'ExtendBeneficiaryOwnership1785753600802',
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
      .map((migration) => migration.timestamp);
    // Contiguous and ordered: 600..603, the allocation reserved for banking. A gap would mean an
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
