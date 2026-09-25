import { Controller, Get, Param } from '@nestjs/common';

import { AgentReceivingNumberService } from './agent-receiving-number.service';

@Controller('agents')
export class AgentReceivingNumberController {
  constructor(private readonly receivingService: AgentReceivingNumberService) {}

  @Get(':id/receiving-number')
  async get(@Param('id') id: string) {
    const view = await this.receivingService.getByAgentId(id);
    if (!view) {
      return { agentId: id, receivingNumber: null, status: 'NONE' };
    }
    return view;
  }
}

@Controller('internal/agents')
export class AgentReceivingNumberInternalController {
  constructor(private readonly receivingService: AgentReceivingNumberService) {}

  @Get(':id/receiving-number')
  async getInternal(@Param('id') id: string) {
    const view = await this.receivingService.getByAgentId(id);
    if (!view) {
      return { agentId: id, receivingNumber: null, status: 'NONE' };
    }
    return view;
  }
}
