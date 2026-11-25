import createHeaders from "./createHeaders.js";
import resolveClientConfig from "../config/clientConfig.js";
import requestLimiter from "./requestLimiter.js";

const RETRIABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class KoleoTransportError extends Error {
  constructor(cause) {
    super('Nie udało się połączyć z KOLEO.', { cause });
    this.name = 'KoleoTransportError';
  }
}

const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason);
    return;
  }

  const onAbort = () => {
    clearTimeout(timer);
    reject(signal.reason);
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, milliseconds);
  signal?.addEventListener('abort', onAbort, { once: true });
});

function retryDelay(response, attempt, config) {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, config.retryMaxDelayMs);
    }
  }

  return Math.min(
    config.retryBaseDelayMs * (2 ** attempt),
    config.retryMaxDelayMs
  );
}

const formRequest = async (endpoint, body = null, accessToken = null, requestOptions = {}) => {
  const method = body ? "POST" : "GET";
  const config = resolveClientConfig(requestOptions.client ?? {});
  const requestUrl = new URL(`${config.apiBaseUrl}${endpoint}`).toString();
  const retryable = requestOptions.retryable ?? method === 'GET';
  const attempts = retryable ? config.maxRetries + 1 : 1;
  const headers = createHeaders(config, true, accessToken);
  const requestBody = body ? JSON.stringify(body) : null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs);
    const signal = requestOptions.signal
      ? AbortSignal.any([requestOptions.signal, timeoutSignal])
      : timeoutSignal;
    const release = await requestLimiter(config.maxConcurrency).acquire(signal);
    const readBody = async (read) => {
      try {
        return await read();
      } catch (error) {
        if (requestOptions.signal?.aborted) {
          throw error;
        }
        if (timeoutSignal.aborted || error instanceof TypeError) {
          throw new KoleoTransportError(error);
        }
        throw error;
      }
    };
    let res;
    try {
      res = await globalThis.fetch(requestUrl, {
        method,
        headers,
        body: requestBody,
        signal,
      });
    } catch (error) {
      if (requestOptions.signal?.aborted) {
        throw error;
      }
      if (attempt === attempts - 1) {
        throw new KoleoTransportError(error);
      }
      await delay(retryDelay(null, attempt, config), requestOptions.signal);
      continue;
    } finally {
      release();
    }

    if (RETRIABLE_STATUS_CODES.has(res.status) && attempt < attempts - 1) {
      await res.body?.cancel();
      await delay(retryDelay(res, attempt, config), requestOptions.signal);
      continue;
    }

    if (!res.ok) {
      const text = await readBody(() => res.text());
      let json = {};
      try {
        json = JSON.parse(text);
      } catch {
        // ignore JSON parse error
      }

      if (res.status === 404) {
        return {
          error: "discoveryError",
          respBody: { text, json },
          method,
          reqPath: requestUrl,
          status: res.status,
        };
      }
      return {
        error: `HTTP ${res.status}`,
        respBody: { text, json },
        method,
        reqPath: requestUrl,
        status: res.status,
      };
    }

    return readBody(() => res.json());
  }
};

export default formRequest;
