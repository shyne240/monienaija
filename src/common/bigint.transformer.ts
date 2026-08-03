import type { ValueTransformer } from 'typeorm';

/** Keep PostgreSQL BIGINT values as strings so JSON never rounds large amounts. */
export const bigintTransformer: ValueTransformer = {
  to: (value: string | number | bigint): string => value.toString(),
  from: (value: string | number | bigint): string => value.toString(),
};
