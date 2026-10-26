import React from 'react';
import { colors } from './tokens';
import type { DashboardPeriod } from './types';

interface PeriodControlsProps {
  period: DashboardPeriod;
  from: string;
  to: string;
  compare?: boolean;
  showCompare?: boolean;
  onPeriodChange: (period: DashboardPeriod) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onCompareChange?: (value: boolean) => void;
}

/** Shared date-range filter control for every widget whose registry entry sets `supportsPeriodFilter: true`. */
export const PeriodControls: React.FC<PeriodControlsProps> = ({
  period,
  from,
  to,
  compare,
  showCompare,
  onPeriodChange,
  onFromChange,
  onToChange,
  onCompareChange,
}) => (
  <div style={styles.row}>
    <select style={styles.select} value={period} onChange={(e) => onPeriodChange(e.target.value as DashboardPeriod)} aria-label="Period">
      <option value="today">Today</option>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="custom">Custom range</option>
    </select>
    {period === 'custom' && (
      <>
        <input type="date" style={styles.dateInput} value={from} onChange={(e) => onFromChange(e.target.value)} aria-label="From date" />
        <span style={styles.toLabel}>to</span>
        <input type="date" style={styles.dateInput} value={to} onChange={(e) => onToChange(e.target.value)} aria-label="To date" />
      </>
    )}
    {showCompare && (
      <label style={styles.compareLabel}>
        <input type="checkbox" checked={!!compare} onChange={(e) => onCompareChange?.(e.target.checked)} />
        Compare to prior period
      </label>
    )}
  </div>
);

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  select: {
    height: 30,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    padding: '0 8px',
    fontSize: 12,
    color: colors.textPrimary,
    backgroundColor: colors.cardBg,
  },
  dateInput: {
    height: 30,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    padding: '0 8px',
    fontSize: 12,
    color: colors.textPrimary,
  },
  toLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  compareLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: colors.textMuted,
  },
};
