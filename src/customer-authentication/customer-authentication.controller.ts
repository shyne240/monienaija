import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateAuthenticationCredentialDto } from './dto/create-authentication-credential.dto';
import { CreateMfaEnrollmentDto } from './dto/create-mfa-enrollment.dto';
import { CreateMfaMethodDto } from './dto/create-mfa-method.dto';
import { CreatePasswordResetRequestDto } from './dto/create-password-reset-request.dto';
import { CreateRecoveryCodeDto } from './dto/create-recovery-code.dto';
import { CreateTrustedDeviceDto } from './dto/create-trusted-device.dto';
import { IssuePasswordResetTokenDto } from './dto/issue-password-reset-token.dto';
import { RecordFailedAuthenticationDto } from './dto/record-failed-authentication.dto';
import { RotatePasswordDto } from './dto/rotate-password.dto';
import { UnlockCredentialDto } from './dto/unlock-credential.dto';
import { UpdateAuthenticationCredentialDto } from './dto/update-authentication-credential.dto';
import { UpdateMfaEnrollmentDto } from './dto/update-mfa-enrollment.dto';
import { UpdateMfaMethodDto } from './dto/update-mfa-method.dto';
import { UpdatePasswordResetRequestDto } from './dto/update-password-reset-request.dto';
import { UpdatePasswordResetTokenDto } from './dto/update-password-reset-token.dto';
import { UpdateRecoveryCodeDto } from './dto/update-recovery-code.dto';
import { UpdateTrustedDeviceDto } from './dto/update-trusted-device.dto';
import { CustomerAuthenticationService } from './customer-authentication.service';

@Controller('customers')
export class CustomerAuthenticationController {
  constructor(private readonly authenticationService: CustomerAuthenticationService) {}

  @Post(':id/authentication-credentials')
  createCredential(@Param('id') id: string, @Body() dto: CreateAuthenticationCredentialDto) {
    return this.authenticationService.createCredential(id, dto);
  }

  @Get(':id/authentication-credentials')
  getCredential(@Param('id') id: string) {
    return this.authenticationService.getCredential(id);
  }

  @Get(':id/authentication-credentials/:credentialId')
  getCredentialById(@Param('id') id: string, @Param('credentialId') credentialId: string) {
    return this.authenticationService.getCredential(id, credentialId);
  }

  @Patch(':id/authentication-credentials/:credentialId')
  updateCredential(
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: UpdateAuthenticationCredentialDto,
  ) {
    return this.authenticationService.updateCredential(id, credentialId, dto);
  }

  @Post(':id/authentication-credentials/:credentialId/password-rotate')
  rotatePassword(
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: RotatePasswordDto,
  ) {
    return this.authenticationService.rotatePassword(id, credentialId, dto);
  }

  @Post(':id/authentication-credentials/:credentialId/failed-attempt')
  recordFailedAuthentication(
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: RecordFailedAuthenticationDto,
  ) {
    return this.authenticationService.recordFailedAuthentication(id, credentialId, dto);
  }

  @Post(':id/authentication-credentials/:credentialId/unlock')
  unlockCredential(
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: UnlockCredentialDto,
  ) {
    return this.authenticationService.unlockCredential(id, credentialId, dto);
  }

  @Get(':id/authentication-credentials/:credentialId/password-history')
  listPasswordHistory(@Param('id') id: string, @Param('credentialId') credentialId: string) {
    return this.authenticationService.listPasswordHistory(id, credentialId);
  }

  @Post(':id/password-reset-requests')
  createPasswordResetRequest(@Param('id') id: string, @Body() dto: CreatePasswordResetRequestDto) {
    return this.authenticationService.createPasswordResetRequest(id, dto);
  }

  @Get(':id/password-reset-requests')
  listPasswordResetRequests(@Param('id') id: string) {
    return this.authenticationService.listPasswordResetRequests(id);
  }

  @Patch(':id/password-reset-requests/:requestId')
  updatePasswordResetRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: UpdatePasswordResetRequestDto,
  ) {
    return this.authenticationService.updatePasswordResetRequest(id, requestId, dto);
  }

  @Post(':id/password-reset-requests/:requestId/token')
  issuePasswordResetToken(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: IssuePasswordResetTokenDto,
  ) {
    return this.authenticationService.issuePasswordResetToken(id, requestId, dto);
  }

  @Get(':id/password-reset-requests/:requestId/tokens')
  listPasswordResetTokens(@Param('id') id: string, @Param('requestId') requestId: string) {
    return this.authenticationService.listPasswordResetTokens(id, requestId);
  }

  @Patch(':id/password-reset-requests/:requestId/tokens/:tokenId')
  updatePasswordResetToken(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Param('tokenId') tokenId: string,
    @Body() dto: UpdatePasswordResetTokenDto,
  ) {
    return this.authenticationService.updatePasswordResetToken(id, requestId, tokenId, dto);
  }

  @Post(':id/mfa-enrollments')
  createMfaEnrollment(@Param('id') id: string, @Body() dto: CreateMfaEnrollmentDto) {
    return this.authenticationService.createMfaEnrollment(id, dto);
  }

  @Get(':id/mfa-enrollments')
  listMfaEnrollments(@Param('id') id: string) {
    return this.authenticationService.listMfaEnrollments(id);
  }

  @Patch(':id/mfa-enrollments/:enrollmentId')
  updateMfaEnrollment(
    @Param('id') id: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: UpdateMfaEnrollmentDto,
  ) {
    return this.authenticationService.updateMfaEnrollment(id, enrollmentId, dto);
  }

  @Post(':id/mfa-enrollments/:enrollmentId/method')
  createMfaMethod(
    @Param('id') id: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: CreateMfaMethodDto,
  ) {
    return this.authenticationService.createMfaMethod(id, enrollmentId, dto);
  }

  @Get(':id/mfa-enrollments/:enrollmentId/methods')
  listMfaMethods(@Param('id') id: string, @Param('enrollmentId') enrollmentId: string) {
    return this.authenticationService.listMfaMethods(id, enrollmentId);
  }

  @Patch(':id/mfa-methods/:methodId')
  updateMfaMethod(
    @Param('id') id: string,
    @Param('methodId') methodId: string,
    @Body() dto: UpdateMfaMethodDto,
  ) {
    return this.authenticationService.updateMfaMethod(id, methodId, dto);
  }

  @Post(':id/trusted-devices')
  createTrustedDevice(@Param('id') id: string, @Body() dto: CreateTrustedDeviceDto) {
    return this.authenticationService.createTrustedDevice(id, dto);
  }

  @Get(':id/trusted-devices')
  listTrustedDevices(@Param('id') id: string) {
    return this.authenticationService.listTrustedDevices(id);
  }

  @Patch(':id/trusted-devices/:deviceId')
  updateTrustedDevice(
    @Param('id') id: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateTrustedDeviceDto,
  ) {
    return this.authenticationService.updateTrustedDevice(id, deviceId, dto);
  }

  @Post(':id/recovery-codes')
  createRecoveryCode(@Param('id') id: string, @Body() dto: CreateRecoveryCodeDto) {
    return this.authenticationService.createRecoveryCode(id, dto);
  }

  @Get(':id/recovery-codes')
  listRecoveryCodes(@Param('id') id: string) {
    return this.authenticationService.listRecoveryCodes(id);
  }

  @Patch(':id/recovery-codes/:codeId')
  updateRecoveryCode(
    @Param('id') id: string,
    @Param('codeId') codeId: string,
    @Body() dto: UpdateRecoveryCodeDto,
  ) {
    return this.authenticationService.updateRecoveryCode(id, codeId, dto);
  }

  @Get(':id/security-events')
  listSecurityEvents(@Param('id') id: string) {
    return this.authenticationService.listSecurityEvents(id);
  }
}
