import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import formRequest from '../src/utils/formRequest.js';

const originalFetch = globalThis.fetch;

const client = (overrides = {}) => ({
  apiBaseUrl: 'https://example.test/v2',
  userAgent: 'open-koleo-offline-test',
  clientName: 'offline-test',
  clientVersion: '1',
  eolResponseVersion: '1',
  requestTimeoutMs: 1_000,
  maxRetries: 2,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 2,
  maxConcurrency: 2,
  ...overrides,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('formRequest offline request policy', () => {
  it('retries retriable responses with bounded backoff', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response('temporarily unavailable', { status: 503 });
      }
      return Response.json({ ok: true });
    };

    const result = await formRequest('/health', null, null, { client: client() });

    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 3);
  });

  it('aborts a request after the configured timeout', async () => {
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });

    await assert.rejects(
      formRequest('/slow', null, null, {
        client: client({ requestTimeoutMs: 20, maxRetries: 0 }),
      }),
      (error) => error?.name === 'TimeoutError'
    );
  });

  it('supports caller cancellation', async () => {
    const controller = new AbortController();
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      if (options.signal.aborted) {
        reject(options.signal.reason);
        return;
      }
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
    const pending = formRequest('/cancelled', null, null, {
      client: client({ maxRetries: 0 }),
      signal: controller.signal,
    });

    controller.abort(new Error('caller cancelled'));

    await assert.rejects(pending, /caller cancelled/);
  });

  it('limits concurrent fetches process-wide', async () => {
    let active = 0;
    let maximumActive = 0;
    globalThis.fetch = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return Response.json({ ok: true });
    };

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        formRequest(`/parallel/${index}`, null, null, {
          client: client({ maxRetries: 0, maxConcurrency: 2 }),
        })
      )
    );

    assert.equal(maximumActive, 2);
  });
});
