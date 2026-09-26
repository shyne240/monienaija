import { IsEnum } from 'class-validator';

import { TerminalStatus } from '../outlet.enums';

export class UpdateTerminalStatusDto {
  @IsEnum(TerminalStatus)
  status!: TerminalStatus;
}
