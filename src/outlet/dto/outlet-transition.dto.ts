import { IsInt, IsOptional, Min } from 'class-validator';

// Optional for older API consumers. Admin Web always submits its last observed version.
export class OutletTransitionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
