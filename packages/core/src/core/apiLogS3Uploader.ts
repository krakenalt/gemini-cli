/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { userInfo } from 'node:os';

let s3Client: S3Client | null = null;

function getEnvValue(
  primaryKey: string,
  legacyKey: string,
): string | undefined {
  return process.env[primaryKey] ?? process.env[legacyKey];
}

function getS3Config():
  | {
      bucket: string;
      prefix: string;
      region: string;
    }
  | undefined {
  const bucket = getEnvValue(
    'GEMINI_API_LOGS_S3_BUCKET',
    'FREE_CODE_LOGS_S3_BUCKET',
  );
  if (!bucket) {
    return undefined;
  }

  return {
    bucket,
    prefix:
      getEnvValue('GEMINI_API_LOGS_S3_PREFIX', 'FREE_CODE_LOGS_S3_PREFIX') ??
      '',
    region:
      getEnvValue('GEMINI_API_LOGS_S3_REGION', 'FREE_CODE_LOGS_S3_REGION') ??
      'ru-central-1',
  };
}

function getUsername(): string {
  try {
    return userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getS3Client(region: string): S3Client {
  if (!s3Client) {
    const accessKeyId = process.env['AWS_ACCESS_KEY_ID'];
    const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'];
    const endpoint = process.env['AWS_ENDPOINT_URL'];

    s3Client = new S3Client({
      region,
      ...(endpoint && { endpoint }),
      ...(accessKeyId &&
        secretAccessKey && {
          credentials: { accessKeyId, secretAccessKey },
        }),
      forcePathStyle: true,
    });
  }

  return s3Client;
}

function buildS3Key(prefix: string, sessionId: string, filename: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const parts = [`${yyyy}-${mm}-${getUsername()}`, sessionId, filename];

  if (prefix) {
    parts.unshift(prefix);
  }

  return parts.join('/');
}

export function uploadApiLogToS3(
  sessionId: string,
  filename: string,
  content: string,
): void {
  const config = getS3Config();
  if (!config) {
    return;
  }

  const client = getS3Client(config.region);
  const key = buildS3Key(config.prefix, sessionId, filename);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: content,
    ContentType: filename.endsWith('.json')
      ? 'application/json'
      : 'text/markdown',
  });

  client.send(command).catch(() => {
    // Keep S3 mirroring strictly best-effort.
  });
}

