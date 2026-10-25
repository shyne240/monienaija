import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { getRequestContext } from '../production/request-context';
import {
  ArchiveProofOfAddressDocumentDto,
  ListProofOfAddressDocumentsDto,
  ProofOfAddressHistoryQueryDto,
  WithdrawProofOfAddressDocumentDto,
  parseUploadFields,
} from './customer-proof-of-address.dto';
import { CustomerProofOfAddressDocumentStatus } from './customer-proof-of-address.enums';
import { CustomerProofOfAddressService } from './customer-proof-of-address.service';
import {
  PROOF_OF_ADDRESS_CONFIG,
  type ProofOfAddressConfiguration,
} from './customer-proof-of-address.config';
import { Inject } from '@nestjs/common';

interface AuthenticatedRequest extends FastifyRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

const WORKFORCE_TYPES = ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

@Controller('customers/:customerId/proof-of-address')
export class CustomerProofOfAddressController {
  constructor(
    private readonly service: CustomerProofOfAddressService,
    private readonly authorization: AuthorizationService,
    @Inject(PROOF_OF_ADDRESS_CONFIG)
    private readonly config: ProofOfAddressConfiguration,
  ) {}

  @Get('capabilities')
  async capabilities(
    @Param('customerId', ParseUUIDPipe) _customerId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.requireFunction(request, 'customer.view_proof_of_address_metadata');
    return this.service.capabilities();
  }

  @Get()
  async list(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: ListProofOfAddressDocumentsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(request, 'customer.view_proof_of_address_metadata');
    const context = getRequestContext(request);
    return this.service.listDocuments(
      customerId,
      query.page,
      query.limit,
      query.documentStatus,
      actor,
      { correlationId: context.correlationId, requestId: context.requestId },
    );
  }

  @Post()
  async upload(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const actor = await this.requireFunction(request, 'customer.upload_proof_of_address');
    this.ensureFeatureEnabled();
    if (!request.isMultipart()) {
      throw new BadRequestException('A multipart/form-data upload is required');
    }
    const idempotencyKey = headerValue(request.headers['idempotency-key']);
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');

    const fields: Record<string, string> = {};
    let upload: { bytes: Buffer; filename: string; mimetype: string } | undefined;
    try {
      for await (const part of request.parts({
        limits: {
          files: 1,
          fields: 8,
          parts: 9,
          fileSize: this.config.maxUploadBytes,
          fieldSize: 2048,
        },
      })) {
        if (part.type === 'file') {
          if (upload) {
            part.file.resume();
            throw new BadRequestException('Exactly one document file may be uploaded');
          }
          const bytes = await part.toBuffer();
          if (part.file.truncated) {
            throw new PayloadTooLargeException(
              'The uploaded document exceeds the configured size limit',
            );
          }
          upload = { bytes, filename: part.filename, mimetype: part.mimetype };
          continue;
        }
        if (part.valueTruncated) {
          throw new BadRequestException('A multipart metadata field exceeds the allowed size');
        }
        if (typeof part.value !== 'string') {
          throw new BadRequestException('Multipart metadata fields must be text');
        }
        if (Object.prototype.hasOwnProperty.call(fields, part.fieldname)) {
          throw new BadRequestException('Duplicate multipart metadata fields are not allowed');
        }
        fields[part.fieldname] = part.value;
      }
    } catch (error) {
      if (error instanceof PayloadTooLargeException || error instanceof BadRequestException)
        throw error;
      if (isMultipartSizeError(error)) {
        throw new PayloadTooLargeException(
          'The uploaded document exceeds the configured size limit',
        );
      }
      throw new BadRequestException('The multipart upload could not be parsed');
    }

    if (!upload) throw new BadRequestException('A document file is required');
    let uploadFields;
    try {
      uploadFields = parseUploadFields(fields);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Upload metadata is invalid',
      );
    }
    const context = getRequestContext(request);
    const result = await this.service.upload(customerId, {
      fields: uploadFields,
      fileName: upload.filename,
      claimedMimeType: upload.mimetype,
      bytes: upload.bytes,
      idempotencyKey,
      actor,
      auditContext: { correlationId: context.correlationId, requestId: context.requestId },
    });
    reply.status(
      result.replayed
        ? 200
        : result.document.documentStatus === CustomerProofOfAddressDocumentStatus.QUARANTINED
          ? 202
          : 201,
    );
    return result.document;
  }

  @Get(':submissionId/history')
  async history(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Query() query: ProofOfAddressHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(request, 'customer.view_proof_of_address_metadata');
    const context = getRequestContext(request);
    return this.service.listHistory(customerId, submissionId, query.page, query.limit, actor, {
      correlationId: context.correlationId,
      requestId: context.requestId,
    });
  }

  @Get(':submissionId/content')
  async content(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Query('disposition') disposition: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const actor = await this.requireFunction(request, 'customer.download_proof_of_address');
    this.ensureFeatureEnabled();
    if (disposition && disposition !== 'inline' && disposition !== 'attachment') {
      throw new BadRequestException('disposition must be inline or attachment');
    }
    const context = getRequestContext(request);
    const document = await this.service.getContent(customerId, submissionId, actor, {
      correlationId: context.correlationId,
      requestId: context.requestId,
    });
    const safeName = sanitizeDownloadFileName(document.fileName);
    const contentDisposition = disposition === 'inline' ? 'inline' : 'attachment';
    reply
      .status(200)
      .header('Content-Type', document.mimeType)
      .header('Content-Length', document.fileSizeBytes)
      .header(
        'Content-Disposition',
        `${contentDisposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      )
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('Pragma', 'no-cache')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('Content-Security-Policy', "sandbox; default-src 'none';")
      .send(document.bytes);
  }

  @Post(':submissionId/withdraw')
  @HttpCode(200)
  async withdraw(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() body: WithdrawProofOfAddressDocumentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(request, 'customer.withdraw_proof_of_address');
    this.ensureFeatureEnabled();
    const context = getRequestContext(request);
    return this.service.withdraw(customerId, submissionId, body.reason, actor, {
      correlationId: context.correlationId,
      requestId: context.requestId,
    });
  }

  @Post(':submissionId/archive')
  @HttpCode(200)
  async archive(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() body: ArchiveProofOfAddressDocumentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(request, 'customer.archive_proof_of_address');
    this.ensureFeatureEnabled();
    const context = getRequestContext(request);
    return this.service.archive(customerId, submissionId, body.reason, actor, {
      correlationId: context.correlationId,
      requestId: context.requestId,
    });
  }

  private async requireFunction(
    request: AuthenticatedRequest,
    functionCode: string,
  ): Promise<{ principalId: string; roleKey: string }> {
    const principal = request.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const principalId = await this.authorization.requireFunction(
      principal,
      functionCode,
      'customer-proof-of-address',
      WORKFORCE_TYPES,
    );
    const preferredRole = principal.roles
      .filter((role) => ['OPERATIONS', 'COMPLIANCE'].includes(role))
      .sort()[0];
    return { principalId, roleKey: preferredRole ?? principal.roles[0] ?? principal.type };
  }

  private ensureFeatureEnabled(): void {
    if (!this.config.enabled) {
      throw new ConflictException('Proof of Address document management is disabled');
    }
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isMultipartSizeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    candidate.code === 'FST_REQ_FILE_TOO_LARGE' || candidate.name === 'RequestFileTooLargeError'
  );
}

function sanitizeDownloadFileName(fileName: string): string {
  const sanitized = Array.from(fileName, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint === 0x2f ||
      codePoint === 0x5c ||
      codePoint === 0x22 ||
      codePoint === 0x3b ||
      codePoint <= 0x1f ||
      codePoint === 0x7f
      ? '_'
      : character;
  })
    .join('')
    .replace(/\.\./g, '_')
    .slice(0, 180);
  return sanitized || 'proof-of-address-document';
}
