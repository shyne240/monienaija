import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { extname } from 'node:path';

import { PROOF_OF_ADDRESS_MIME_BY_EXTENSION } from './customer-proof-of-address.constants';

export interface ValidatedProofOfAddressFile {
  originalFileName: string;
  detectedMimeType: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_FILENAME_BYTES = 255;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 20_000_000;

/**
 * Validate untrusted multipart metadata and file signatures before persistence. The filename is
 * metadata only; no client-provided filename or path is ever used to construct a storage key.
 */
export function validateProofOfAddressFile(
  fileName: string,
  claimedMimeType: string,
  bytes: Buffer,
  maxBytes: number,
): ValidatedProofOfAddressFile {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new BadRequestException('The uploaded document is empty');
  }
  if (bytes.length > maxBytes) {
    throw new PayloadTooLargeException(`The uploaded document exceeds the ${maxBytes}-byte limit`);
  }
  if (
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    Buffer.byteLength(fileName, 'utf8') > MAX_FILENAME_BYTES ||
    hasUnsafeFileNameCharacters(fileName) ||
    fileName.includes('..')
  ) {
    throw new BadRequestException('The document filename is invalid');
  }

  const extension = extname(fileName).toLowerCase();
  const expectedMimeType = PROOF_OF_ADDRESS_MIME_BY_EXTENSION[extension];
  if (!expectedMimeType) {
    throw new BadRequestException('Only PDF, JPEG, and PNG documents are accepted');
  }
  const normalizedClaim = claimedMimeType.split(';', 1)[0]?.trim().toLowerCase();
  if (normalizedClaim !== expectedMimeType) {
    throw new BadRequestException('The claimed media type does not match the document extension');
  }

  const signatureMatches =
    expectedMimeType === 'application/pdf'
      ? isPdf(bytes)
      : expectedMimeType === 'image/jpeg'
        ? isJpeg(bytes)
        : isPng(bytes);
  if (!signatureMatches) {
    throw new BadRequestException('The document signature does not match its claimed media type');
  }

  return { originalFileName: fileName, detectedMimeType: expectedMimeType };
}

function hasUnsafeFileNameCharacters(fileName: string): boolean {
  return (
    fileName.includes('/') ||
    fileName.includes('\\') ||
    Array.from(fileName).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function isPdf(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return false;
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1');
  const eofIndex = tail.lastIndexOf('%%EOF');
  if (eofIndex < 0) return false;
  return Array.from(tail.slice(eofIndex + 5)).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || codePoint === 0x20;
  });
}

function isJpeg(bytes: Buffer): boolean {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return false;
  }

  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || marker === 0xd9) return false;
    if (marker === 0xda) {
      if (!sawFrame || offset + 2 > bytes.length - 2) return false;
      const scanHeaderLength = bytes.readUInt16BE(offset);
      if (scanHeaderLength < 6 || offset + scanHeaderLength >= bytes.length - 2) return false;
      sawScan = true;
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length - 2) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length - 2) return false;

    if (isJpegStartOfFrameMarker(marker)) {
      if (segmentLength < 11) return false;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      const componentCount = bytes[offset + 7] ?? 0;
      if (
        componentCount < 1 ||
        componentCount > 4 ||
        segmentLength !== 8 + 3 * componentCount ||
        !isSafeImageSize(width, height)
      ) {
        return false;
      }
      sawFrame = true;
    }
    offset += segmentLength;
  }
  return sawFrame && sawScan;
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
    marker,
  );
}

function isSafeImageSize(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_DIMENSION &&
    height <= MAX_IMAGE_DIMENSION &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

function isPng(bytes: Buffer): boolean {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return false;

  let offset = 8;
  let chunkNumber = 0;
  let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.subarray(offset + 4, offset + 8);
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(bytes.subarray(offset + 4, crcOffset));
    if (expectedCrc !== actualCrc) return false;

    const name = type.toString('ascii');
    if (chunkNumber === 0 && (name !== 'IHDR' || length !== 13)) return false;
    if (name === 'IHDR') {
      if (chunkNumber !== 0 || length !== 13) return false;
      const width = bytes.readUInt32BE(dataStart);
      const height = bytes.readUInt32BE(dataStart + 4);
      if (!isSafeImageSize(width, height)) return false;
    }
    if (name === 'IDAT') sawIdat = true;
    if (name === 'IEND') {
      return length === 0 && sawIdat && crcOffset + 4 === bytes.length;
    }
    offset = crcOffset + 4;
    chunkNumber++;
  }
  return false;
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
