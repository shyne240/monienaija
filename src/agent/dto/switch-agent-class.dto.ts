import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

/**
 * V1-AGENT-CLASS-LIFECYCLE-01 — governed post-activation class switch.
 *
 * The reason is mandatory (mirrors `customer-class-assignment.service.ts`, where a MANUAL/SWITCH
 * change requires a non-empty justification) because a class change silently widens or narrows the
 * Agent's permissible services. `expectedVersion` makes the write optimistic-locking aware so a
 * stale inspector cannot overwrite a change made by another operator.
 */
export class SwitchAgentClassDto {
  @IsUUID()
  targetClassId!: string;

  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
