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

  it('adopts the published Arena 2 range without fabricating 0117', () => {
    const timestamps = new Set(migrations.map((migration) => migration.timestamp));
    // Arena 1's governed ledger reversal owns `0117`; this branch still excludes it and must not
    // invent it. The remaining lower-numbered Arena 2 evidence migrations are now adopted with
    // their published identifiers (ARENA 3 consolidation, Phase 4).
    expect(timestamps.has('1785753600117')).toBe(false);
    for (const id of [120, 130, 131, 132, 200, 201, 202, 203, 204, 205]) {
      expect(timestamps.has(`1785753600${id}`)).toBe(true);
    }
    // The adjacent published migrations that the supported upgrade path does use remain present.
    expect(timestamps.has('1785753600116')).toBe(true);
    expect(timestamps.has('1785753600118')).toBe(true);
  });

  it('ends at the Cash-Out institutional scope correction', () => {
    expect(migrations.at(-1)).toMatchObject({
      timestamp: '1785753600503',
      name: 'CashOutInstitutionalScope1785753600503',
    });
  });

  it('orders the adopted Arena 2 evidence migrations before the institutional chain', () => {
    const timestamps = migrations.map((migration) => migration.timestamp);
    const arena2 = ['1785753600205', '1785753600400', '1785753600503'];
    const positions = arena2.map((timestamp) => timestamps.indexOf(timestamp));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    // A newly adopted lower-numbered migration must never be inserted after a higher published
    // one in file order: the supported upgrade applies them in timestamp order.
    expect(timestamps).toEqual([...timestamps].sort());
  });
});
