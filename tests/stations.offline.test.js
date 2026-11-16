import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import Stations from '../src/modules/stations.js';

const originalFetch = globalThis.fetch;

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

    await new Stations().findStationsByName('  WrOcŁaW & okolice  ');

    const url = new URL(requestedUrl);
    assert.equal(url.pathname, '/v2/main/livesearch');
    assert.equal(url.searchParams.get('q'), 'wrocław & okolice');
  });
});
