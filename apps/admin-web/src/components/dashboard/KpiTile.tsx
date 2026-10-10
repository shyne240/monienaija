import React from 'react';
import { colors } from './tokens';

interface KpiTileProps {
  label: string;
  value: string;
  caption?: string;
  deltaLabel?: string;
  deltaTone?: 'positive' | 'negative' | 'neutral';
  title?: string;
}

export const KpiTile: React.FC<KpiTileProps> = ({ label, value, caption, deltaLabel, deltaTone = 'neutral', title }) => (
  <div style={styles.tile} title={title}>
    <span style={styles.label}>{label}</span>
    <span style={styles.value}>{value}</span>
    {deltaLabel && (
      <span
        style={{
          ...styles.delta,
          color: deltaTone === 'positive' ? colors.success : deltaTone === 'negative' ? colors.danger : colors.textMuted,
        }}
      >
        {deltaLabel}
      </span>
    )}
    {caption && <span style={styles.caption}>{caption}</span>}
  </div>
);

const styles: Record<string, React.CSSProperties> = {
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '14px 16px',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    minWidth: 150,
    flex: '1 1 150px',
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  value: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  delta: {
    fontSize: 12,
    fontWeight: 600,
  },
  caption: {
    fontSize: 10,
    color: colors.textFaint,
  },
};
