import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import { ComplianceCaseAssignment } from './compliance-case-assignment.entity';
import { ComplianceCaseComment } from './compliance-case-comment.entity';
import { ComplianceCaseEvidence } from './compliance-case-evidence.entity';
import { ComplianceCaseHistory } from './compliance-case-history.entity';
import { CustomerComplianceCase } from './customer-compliance-case.entity';
import { CustomerComplianceController } from './customer-compliance.controller';
import { CustomerComplianceService } from './customer-compliance.service';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerComplianceCase,
      ComplianceCaseHistory,
      ComplianceCaseAssignment,
      ComplianceCaseComment,
      ComplianceCaseEvidence,
    ]),
  ],
  controllers: [CustomerComplianceController],
  providers: [CustomerComplianceService],
  exports: [CustomerComplianceService],
})
export class CustomerComplianceModule {}
