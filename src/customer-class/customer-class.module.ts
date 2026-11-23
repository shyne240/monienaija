import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { CustomerClass } from './customer-class.entity';
import { CustomerClassAssignment } from './customer-class-assignment.entity';
import { CustomerClassService } from './customer-class.service';
import { CustomerClassAssignmentService } from './customer-class-assignment.service';
import { CustomerClassResolverService } from './customer-class-resolver.service';
import {
  CustomerClassAssignmentController,
  CustomerClassController,
} from './customer-class.controller';

/**
 * ARENA 1 — customer classes of service (coordination §3.1). The resolver is exported so Arena 3
 * can consume the class code for limit SEGMENT targeting / approved class pricing without
 * duplicating class logic; nothing here reads KYC tier state.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerClass, CustomerClassAssignment]),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => OperationsModule),
  ],
  controllers: [CustomerClassController, CustomerClassAssignmentController],
  providers: [CustomerClassService, CustomerClassAssignmentService, CustomerClassResolverService],
  exports: [CustomerClassService, CustomerClassAssignmentService, CustomerClassResolverService],
})
export class CustomerClassModule {}
