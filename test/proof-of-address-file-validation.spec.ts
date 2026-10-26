import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { deflateSync } from 'node:zlib';

import { validateProofOfAddressFile } from '../src/customer-proof-of-address/proof-of-address-file-validation';

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'ascii');
const JPEG_BYTES = createJpeg();
const PNG_BYTES = createPng();

describe('validateProofOfAddressFile', () => {
  it.each([
    ['utility.pdf', 'application/pdf', PDF_BYTES, 'application/pdf'],
    ['scan.jpg', 'image/jpeg', JPEG_BYTES, 'image/jpeg'],
    ['scan.jpeg', 'image/jpeg; charset=binary', JPEG_BYTES, 'image/jpeg'],
    ['scan.png', 'image/png', PNG_BYTES, 'image/png'],
  ])('accepts a signature-checked candidate file: %s', (filename, mime, bytes, detectedMime) => {
    expect(validateProofOfAddressFile(filename, mime, bytes, 1024)).toEqual({
      originalFileName: filename,
      detectedMimeType: detectedMime,
    });
  });

  it('rejects extension and claimed-media-type mismatches', () => {
    expect(() =>
      validateProofOfAddressFile('statement.pdf', 'image/jpeg', PDF_BYTES, 1024),
    ).toThrow(BadRequestException);
    expect(() =>
      validateProofOfAddressFile('statement.pdf', 'application/pdf', JPEG_BYTES, 1024),
    ).toThrow(/signature does not match/);
  });

  it('rejects unsupported file types and traversal-style filenames', () => {
    expect(() =>
      validateProofOfAddressFile('statement.exe', 'application/pdf', PDF_BYTES, 1024),
    ).toThrow(/Only PDF, JPEG, and PNG/);
    expect(() =>
      validateProofOfAddressFile('../statement.pdf', 'application/pdf', PDF_BYTES, 1024),
    ).toThrow(/filename is invalid/);
    expect(() =>
      validateProofOfAddressFile('folder\\statement.pdf', 'application/pdf', PDF_BYTES, 1024),
    ).toThrow(/filename is invalid/);
  });

  it('enforces the configured byte limit before signature processing', () => {
    expect(() =>
      validateProofOfAddressFile('statement.pdf', 'application/pdf', PDF_BYTES, 8),
    ).toThrow(PayloadTooLargeException);
  });

  it('rejects malformed PNG chunk CRCs, non-PDF data, and oversized image dimensions', () => {
    const malformedPng = Buffer.from(PNG_BYTES);
    malformedPng[malformedPng.length - 1] = (malformedPng[malformedPng.length - 1] ?? 0) ^ 1;
    expect(() => validateProofOfAddressFile('scan.png', 'image/png', malformedPng, 1024)).toThrow(
      /signature does not match/,
    );
    expect(() =>
      validateProofOfAddressFile(
        'statement.pdf',
        'application/pdf',
        Buffer.from('not a PDF'),
        1024,
      ),
    ).toThrow(/signature does not match/);
    expect(() =>
      validateProofOfAddressFile('large.png', 'image/png', createPng(5000, 5000), 1024),
    ).toThrow(/signature does not match/);
    expect(() =>
      validateProofOfAddressFile('large.jpg', 'image/jpeg', createJpeg(5000, 5000), 1024),
    ).toThrow(/signature does not match/);
  });
});

function createPng(width = 1, height = 1): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rawPixel = Buffer.from([0, 32, 64, 96, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rawPixel)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createJpeg(width = 1, height = 1): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x02]);
  const startOfFrame = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
  const startOfScan = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    startOfFrame,
    startOfScan,
    Buffer.from([0x00, 0xff, 0xd9]),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunkTypeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(chunkTypeAndData), 0);
  return Buffer.concat([length, chunkTypeAndData, crc]);
}

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
