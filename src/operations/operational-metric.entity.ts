import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'operational_metrics' })
export class OperationalMetric {
  @PrimaryColumn({ name: 'metric_name', type: 'varchar', length: 120 })
  metricName!: string;

  @Column({ type: 'bigint', default: 0 })
  value!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
