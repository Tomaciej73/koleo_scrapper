import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import Stations from '../src/modules/stations.js';

const originalFetch = globalThis.fetch;
const clientOptions = {
  apiBaseUrl: 'https://example.test/v2',
  userAgent: 'open-koleo-offline-test',
  clientName: 'offline-test',
  clientVersion: '1',
  eolResponseVersion: '1',
  requestTimeoutMs: 1_000,
  maxRetries: 0,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 1,
  maxConcurrency: 2,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Stations Module offline', () => {
  it('normalizes case and safely encodes livesearch input', async () => {
    let requestedUrl;
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ stations: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await new Stations(clientOptions).findStationsByName('  WrOcŁaW & okolice  ');

    const url = new URL(requestedUrl);
    assert.equal(url.pathname, '/v2/main/livesearch');
    assert.equal(url.searchParams.get('q'), 'wrocław & okolice');
  });
});
