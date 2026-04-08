/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const sendMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const S3Client = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    send: sendMock,
  })),
);
const PutObjectCommand = vi.hoisted(() =>
  vi.fn().mockImplementation((input) => input),
);
const userInfo = vi.hoisted(() => vi.fn(() => ({ username: 'alice' })));

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand,
  S3Client,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    userInfo,
  };
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('uploadApiLogToS3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T12:34:56.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('skips uploads when bucket is not configured', async () => {
    const { uploadApiLogToS3 } = await import('./apiLogS3Uploader.js');

    uploadApiLogToS3('session-123', 'README.md', 'body');

    expect(S3Client).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('uploads markdown and json logs with gemini env config', async () => {
    vi.stubEnv('GEMINI_API_LOGS_S3_BUCKET', 'bucket-a');
    vi.stubEnv('GEMINI_API_LOGS_S3_PREFIX', 'prefix-a');
    vi.stubEnv('GEMINI_API_LOGS_S3_REGION', 'ru-central-1');
    vi.stubEnv('AWS_ENDPOINT_URL', 'https://storage.example.com');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'key');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret');

    const { uploadApiLogToS3 } = await import('./apiLogS3Uploader.js');

    uploadApiLogToS3('session-123', 'README.md', 'markdown');
    uploadApiLogToS3('session-123', 'entry_request.json', '{"ok":true}');

    expect(S3Client).toHaveBeenCalledWith({
      region: 'ru-central-1',
      endpoint: 'https://storage.example.com',
      credentials: {
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
      forcePathStyle: true,
    });
    expect(PutObjectCommand).toHaveBeenNthCalledWith(1, {
      Bucket: 'bucket-a',
      Key: 'prefix-a/2026-04-alice/session-123/README.md',
      Body: 'markdown',
      ContentType: 'text/markdown',
    });
    expect(PutObjectCommand).toHaveBeenNthCalledWith(2, {
      Bucket: 'bucket-a',
      Key: 'prefix-a/2026-04-alice/session-123/entry_request.json',
      Body: '{"ok":true}',
      ContentType: 'application/json',
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('supports the legacy free_code env names and swallows upload errors', async () => {
    vi.stubEnv('FREE_CODE_LOGS_S3_BUCKET', 'legacy-bucket');
    sendMock.mockRejectedValueOnce(new Error('boom'));

    const { uploadApiLogToS3 } = await import('./apiLogS3Uploader.js');

    expect(() =>
      uploadApiLogToS3('session-999', 'README.md', 'content'),
    ).not.toThrow();

    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'legacy-bucket',
      Key: '2026-04-alice/session-999/README.md',
      Body: 'content',
      ContentType: 'text/markdown',
    });
  });
});
