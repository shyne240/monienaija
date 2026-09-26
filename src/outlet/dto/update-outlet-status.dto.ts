import { IsEnum } from 'class-validator';

import { OutletStatus } from '../outlet.enums';

export class UpdateOutletStatusDto {
  @IsEnum(OutletStatus)
  status!: OutletStatus;
}
