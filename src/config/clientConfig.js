const REQUIRED_STRING_OPTIONS = {
  apiBaseUrl: 'KOLEO_API_BASE_URL',
  userAgent: 'KOLEO_CLIENT_USER_AGENT',
  clientName: 'KOLEO_CLIENT_NAME',
  clientVersion: 'KOLEO_CLIENT_VERSION',
  eolResponseVersion: 'KOLEO_EOL_RESPONSE_VERSION',
};

const REQUIRED_NUMBER_OPTIONS = {
  requestTimeoutMs: 'KOLEO_REQUEST_TIMEOUT_MS',
  maxRetries: 'KOLEO_REQUEST_MAX_RETRIES',
  retryBaseDelayMs: 'KOLEO_REQUEST_RETRY_BASE_DELAY_MS',
  retryMaxDelayMs: 'KOLEO_REQUEST_RETRY_MAX_DELAY_MS',
  maxConcurrency: 'KOLEO_REQUEST_MAX_CONCURRENCY',
};

export class KoleoConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KoleoConfigurationError';
  }
}

function stringOption(options, property, environmentName) {
  const value = options[property] ?? process.env[environmentName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new KoleoConfigurationError(
      `Missing KOLEO client configuration: ${environmentName}`
    );
  }
  return value.trim();
}

function numberOption(options, property, environmentName) {
  const raw = options[property] ?? process.env[environmentName];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new KoleoConfigurationError(
      `Invalid KOLEO client configuration: ${environmentName} must be a non-negative integer`
    );
  }
  return value;
}

export default function resolveClientConfig(options = {}) {
  const strings = Object.fromEntries(
    Object.entries(REQUIRED_STRING_OPTIONS).map(([property, environmentName]) => [
      property,
      stringOption(options, property, environmentName),
    ])
  );
  const numbers = Object.fromEntries(
    Object.entries(REQUIRED_NUMBER_OPTIONS).map(([property, environmentName]) => [
      property,
      numberOption(options, property, environmentName),
    ])
  );

  let apiUrl;
  try {
    apiUrl = new URL(strings.apiBaseUrl);
  } catch {
    throw new KoleoConfigurationError('KOLEO_API_BASE_URL must be a valid URL');
  }

  if (!['http:', 'https:'].includes(apiUrl.protocol)) {
    throw new KoleoConfigurationError('KOLEO_API_BASE_URL must use http or https');
  }
  if (numbers.requestTimeoutMs < 1 || numbers.maxConcurrency < 1) {
    throw new KoleoConfigurationError(
      'KOLEO_REQUEST_TIMEOUT_MS and KOLEO_REQUEST_MAX_CONCURRENCY must be greater than zero'
    );
  }
  if (numbers.retryMaxDelayMs < numbers.retryBaseDelayMs) {
    throw new KoleoConfigurationError(
      'KOLEO_REQUEST_RETRY_MAX_DELAY_MS must be greater than or equal to KOLEO_REQUEST_RETRY_BASE_DELAY_MS'
    );
  }

  return Object.freeze({
    ...strings,
    ...numbers,
    apiBaseUrl: strings.apiBaseUrl.replace(/\/+$/, ''),
  });
}
