import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02 (defect fix)
 *
 * The V1 version of this DTO had no class-validator decorators at all. Under the application's
 * global `ValidationPipe({ whitelist: true, transform: true })` (src/main.ts), `whitelist: true`
 * strips any property from the transformed instance that is not recognised by at least one
 * class-validator decorator — an undecorated class is treated as having zero known properties, so
 * the entire request body was silently discarded before the controller's own manual check ran,
 * and `PUT /assignments/:roleKey` returned 400 "templateKey is required." on every call,
 * regardless of payload. Decorating the fields here is the root-cause fix (see
 * docs/V1/V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01-REPORT.md §7, Defect #1), following the same
 * convention used throughout the codebase (e.g. src/bank/dto/update-bank.dto.ts).
 */
export class AssignTemplateDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(80)
  templateKey!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(500)
  reason?: string;
}
