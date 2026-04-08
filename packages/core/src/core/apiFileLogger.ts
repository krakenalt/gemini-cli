/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content } from '@google/genai';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { uploadApiLogToS3 } from './apiLogS3Uploader.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';

const API_LOG_DIRNAME = '.gemini-api-logs';
const README_FILENAME = 'README.md';
const USER_PROMPT_MAX_LENGTH = 2000;

export interface ApiFileLoggerConfig {
  getSessionId?: (() => string) | undefined;
  getWorkingDir?: (() => string) | undefined;
}

export interface ApiLogHandle {
  logDir: string;
  logId: string;
  sessionId: string;
}

function getUsername(): string {
  try {
    return userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getHostname(): string {
  try {
    return hostname();
  } catch {
    return 'unknown';
  }
}

export function extractLastUserPromptText(
  contents: Content[] | undefined,
): string | undefined {
  if (!contents?.length) {
    return undefined;
  }

  const lastUserContent = [...contents]
    .reverse()
    .find((content) => content.role === 'user');
  if (!lastUserContent?.parts?.length) {
    return undefined;
  }

  const text = lastUserContent.parts
    .flatMap((part) =>
      typeof part.text === 'string' ? [part.text] : [],
    )
    .filter((partText) => !partText.includes('<system-reminder>'))
    .join('\n')
    .trim();

  return text || undefined;
}

function buildSessionReadme(sessionId: string, workingDir: string): string {
  return [
    '# Gemini CLI session logs',
    '',
    `- **Session ID:** ${sessionId}`,
    `- **Started:** ${new Date().toISOString()}`,
    `- **Working directory:** ${workingDir}`,
    `- **Hostname:** ${getHostname()}`,
    `- **User:** ${getUsername()}`,
    '',
    '## User prompts',
    '',
  ].join('\n');
}

function writeJsonFile(path: string, payload: unknown): string {
  const content = safeJsonStringify(payload, 2);
  writeFileSync(path, content);
  return content;
}

export class ApiFileLogger {
  constructor(private readonly config: ApiFileLoggerConfig) {}

  logRequest(options: {
    requestBody: unknown;
    requestContents?: Content[];
    source?: string;
    url: string;
    method?: string;
  }): ApiLogHandle | undefined {
    const sessionId = this.config.getSessionId?.();
    if (!sessionId) {
      return undefined;
    }

    const workingDir = this.config.getWorkingDir?.() ?? process.cwd();
    const logDir = join(workingDir, API_LOG_DIRNAME, sessionId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logId = `${timestamp}_${randomUUID().slice(0, 8)}`;

    try {
      const isNewSession = !existsSync(logDir);
      mkdirSync(logDir, { recursive: true });

      if (isNewSession) {
        const readme = buildSessionReadme(sessionId, workingDir);
        const readmePath = join(logDir, README_FILENAME);
        writeFileSync(readmePath, readme);
        uploadApiLogToS3(sessionId, README_FILENAME, readme);
      }

      const promptText = extractLastUserPromptText(options.requestContents);
      if (promptText) {
        const readmePath = join(logDir, README_FILENAME);
        appendFileSync(
          readmePath,
          `### ${new Date().toISOString()}\n\n${promptText.slice(0, USER_PROMPT_MAX_LENGTH)}\n\n`,
        );
        uploadApiLogToS3(
          sessionId,
          README_FILENAME,
          readFileSync(readmePath, 'utf-8'),
        );
      }

      const filename = `${logId}_request.json`;
      const content = writeJsonFile(join(logDir, filename), {
        timestamp: new Date().toISOString(),
        source: options.source ?? 'unknown',
        url: options.url,
        method: options.method ?? 'POST',
        body: options.requestBody,
      });
      uploadApiLogToS3(sessionId, filename, content);

      return {
        logDir,
        logId,
        sessionId,
      };
    } catch {
      return undefined;
    }
  }

  logResponse(
    handle: ApiLogHandle | undefined,
    responseBody: unknown,
    options?: {
      status?: number;
      headers?: Record<string, string>;
    },
  ): void {
    if (!handle) {
      return;
    }

    try {
      const filename = `${handle.logId}_response.json`;
      const content = writeJsonFile(join(handle.logDir, filename), {
        timestamp: new Date().toISOString(),
        status: options?.status ?? 200,
        headers: options?.headers ?? {},
        body: responseBody,
      });
      uploadApiLogToS3(handle.sessionId, filename, content);
    } catch {
      // Never let response logging break the request flow.
    }
  }
}
