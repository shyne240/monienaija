import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

import { AggregatorStatus } from '../aggregator.enums';

export class UpdateAggregatorStatusDto {
  @IsEnum(AggregatorStatus)
  status!: AggregatorStatus;

  @IsOptional()
  @IsString()
  @Length(2, 500)
  reason?: string;
}
