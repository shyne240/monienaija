import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { SupportWorkforceUser } from './support-workforce-user.entity';
import { SupportWorkforceSession } from './support-workforce-session.entity';
import { SupportAuthenticationService } from './support-authentication.service';
import { SupportAuthenticationController } from './support-authentication.controller';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([SupportWorkforceUser, SupportWorkforceSession]),
  ],
  controllers: [SupportAuthenticationController],
  providers: [SupportAuthenticationService],
  exports: [SupportAuthenticationService],
})
export class SupportAuthenticationModule {}
