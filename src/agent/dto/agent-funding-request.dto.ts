import { IsString, Length } from 'class-validator';
import { FundAgentDto } from './fund-agent.dto';

export class RequestAgentFundingDto extends FundAgentDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class RejectAgentFundingRequestDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
