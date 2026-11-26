import { IsNotEmpty, IsObject, IsString, MaxLength, MinLength } from 'class-validator';

export class ConfigureTierDefaultClassesDto {
  @IsObject()
  tierDefaults!: Record<string, string>;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
