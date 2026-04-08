/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const uploadApiLogToS3 = vi.hoisted(() => vi.fn());

vi.mock('./apiLogS3Uploader.js', () => ({
  uploadApiLogToS3,
}));

vi.mock('node:crypto', () => ({
  randomUUID: () => '12345678-1234-1234-1234-123456789abc',
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ApiFileLogger,
  extractLastUserPromptText,
} from './apiFileLogger.js';

describe('ApiFileLogger', () => {
  let workingDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T12:34:56.000Z'));
    workingDir = mkdtempSync(join(tmpdir(), 'gemini-api-file-logger-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(workingDir, { recursive: true, force: true });
  });

  it('extracts the last user text prompt and skips system reminders', () => {
    expect(
      extractLastUserPromptText([
        {
          role: 'user',
          parts: [{ text: 'first prompt' }],
        },
        {
          role: 'model',
          parts: [{ text: 'model reply' }],
        },
        {
          role: 'user',
          parts: [
            { text: 'final prompt' },
            { text: '<system-reminder>ignore me</system-reminder>' },
          ],
        },
      ]),
    ).toBe('final prompt');
  });

  it('creates README plus request and response logs for a session', () => {
    const logger = new ApiFileLogger({
      getSessionId: () => 'session-123',
      getWorkingDir: () => workingDir,
    });
    const requestBody = {
      model: 'gemini-pro',
      contents: [
        {
          role: 'user',
          parts: [{ text: 'hello from user' }],
        },
      ],
    };

    const handle = logger.logRequest({
      requestBody,
      requestContents: requestBody.contents,
      source: 'gemini-api',
      url: 'https://generativelanguage.googleapis.com/generateContent',
    });

    expect(handle).toBeDefined();

    const sessionDir = join(workingDir, '.gemini-api-logs', 'session-123');
    expect(existsSync(sessionDir)).toBe(true);

    const readme = readFileSync(join(sessionDir, 'README.md'), 'utf-8');
    expect(readme).toContain('# Gemini CLI session logs');
    expect(readme).toContain('**Session ID:** session-123');
    expect(readme).toContain('hello from user');

    const requestFile = readdirSync(sessionDir).find((file) =>
      file.endsWith('_request.json'),
    );
    expect(requestFile).toBeDefined();
    expect(readFileSync(join(sessionDir, requestFile!), 'utf-8')).toContain(
      '"source": "gemini-api"',
    );

    logger.logResponse(
      handle,
      { candidates: [{ content: { parts: [{ text: 'hello back' }] } }] },
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );

    const responseFile = readdirSync(sessionDir).find((file) =>
      file.endsWith('_response.json'),
    );
    expect(responseFile).toBeDefined();
    expect(readFileSync(join(sessionDir, responseFile!), 'utf-8')).toContain(
      '"status": 200',
    );

    expect(uploadApiLogToS3).toHaveBeenCalledWith(
      'session-123',
      'README.md',
      expect.stringContaining('# Gemini CLI session logs'),
    );
    expect(uploadApiLogToS3).toHaveBeenCalledWith(
      'session-123',
      requestFile,
      expect.stringContaining('"body"'),
    );
    expect(uploadApiLogToS3).toHaveBeenCalledWith(
      'session-123',
      responseFile,
      expect.stringContaining('"candidates"'),
    );
  });

  it('does nothing when session id is unavailable', () => {
    const logger = new ApiFileLogger({
      getWorkingDir: () => workingDir,
    });

    const handle = logger.logRequest({
      requestBody: { contents: [] },
      requestContents: [],
      url: 'https://example.com',
    });

    expect(handle).toBeUndefined();
    expect(uploadApiLogToS3).not.toHaveBeenCalled();
    expect(existsSync(join(workingDir, '.gemini-api-logs'))).toBe(false);
  });
});

