import env from '#start/env'
import type {
  ConnectionMetadata,
  ConnectionResult,
  ConnectionSearchInput,
  WatchedConnectionResult,
} from '#services/connection_search_service'
import { ConnectionSearchError } from '#services/connection_search_service'
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'

interface CdTrain {
  trainName?: string
  trainNum?: string
  from?: string
  to?: string
  depDate?: string
  depTime?: string
  arrDate?: string
  arrTime?: string
}

interface CdConnection {
  handle: number
  id: number
  auxDesc?: string
  changesCount?: number
  trains?: CdTrain[]
}

interface CdPageModel {
  guid: string
  pageType: number
  list: CdConnection[]
}

interface CdPage {
  model: CdPageModel
  token: string
  cookies: string
}

interface CdPublicOptions {
  webBaseUrl?: string
  stationAutocompleteUrl?: string
  stationCombination?: string
  stationLanguage?: string
  requestTimeoutMs?: number
  maxRedirects?: number
  maxRetries?: number
  retryBaseDelayMs?: number
  maxConcurrency?: number
}

export default class CdPublicService {
  private readonly pages = new Map<string, Promise<CdPage>>()
  private readonly prices = new Map<string, Promise<ConnectionResult>>()

  constructor(private readonly options: CdPublicOptions = {}) {}

  async stations(query: string, limit: number) {
    const endpoint = this.options.stationAutocompleteUrl ?? env.get('CD_STATION_AUTOCOMPLETE_URL')
    if (!endpoint)
      throw new ConnectionSearchError('Źródło ČD nie jest skonfigurowane.', 'cdNotConfigured')
    const transliterated = query
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .replaceAll('ł', 'l')
      .replaceAll('Ł', 'L')
    const queries = transliterated === query ? [query] : [transliterated, query]
    for (const stationQuery of queries) {
      const stations = await this.loadStations(endpoint, stationQuery, limit)
      if (stations.length) return stations
    }
    return []
  }

  private async loadStations(endpoint: string, query: string, limit: number) {
    const url = new URL(endpoint)
    url.searchParams.set('prefixText', query)
    url.searchParams.set('count', String(limit))
    url.searchParams.set(
      'lang',
      this.requiredString(this.options.stationLanguage ?? env.get('CD_STATION_LANGUAGE'))
    )
    url.searchParams.set(
      'combination',
      this.requiredString(this.options.stationCombination ?? env.get('CD_STATION_COMBINATION'))
    )
    url.searchParams.set('format', 'json')
    url.searchParams.set('callback', 'cdwatch')
    const response = await this.request(url)
    const body = await response.text()
    const match = /^cdwatch\((\[.*\])\);?\s*$/s.exec(body.trim())
    if (!match)
      throw new ConnectionSearchError('Nieprawidłowa odpowiedź stacji ČD.', 'cdStationsInvalid')
    const rows = JSON.parse(match[1]) as unknown
    if (!Array.isArray(rows))
      throw new ConnectionSearchError('Nieprawidłowa lista stacji ČD.', 'cdStationsInvalid')
    return rows
      .filter(
        (row): row is { selectedText: string; iconId: number; value: string } =>
          typeof row?.selectedText === 'string' &&
          row.iconId === 3 &&
          Number.isInteger(Number(row.value)) &&
          Number(row.value) > 0 &&
          Number(row.value) <= 0x7fffffff
      )
      .slice(0, limit)
      .map((row) => ({ id: Number(row.value), name: row.selectedText, slug: null }))
  }

  async search(input: ConnectionSearchInput): Promise<ConnectionResult[]> {
    const page = await this.getPage(input)
    const candidates = this.candidates(page, input)
    const results: ConnectionResult[] = []
    const concurrency = this.requiredNumber(
      this.options.maxConcurrency ?? env.get('CD_REQUEST_MAX_CONCURRENCY'),
      1
    )
    for (let index = 0; index < candidates.length; index += concurrency) {
      results.push(
        ...(await Promise.all(
          candidates
            .slice(index, index + concurrency)
            .map((candidate) => this.price(page, candidate))
        ))
      )
    }
    return results
  }

  async searchForWatch(
    input: ConnectionSearchInput,
    select: (connections: ConnectionMetadata[]) => string | undefined
  ): Promise<WatchedConnectionResult> {
    const page = await this.getPage(input)
    const candidates = this.candidates(page, input)
    const metadata = candidates.map((candidate) => this.metadata(candidate))
    const uuid = select(metadata)
    const selected = candidates.find((candidate) => this.metadata(candidate).uuid === uuid)
    return {
      connection: selected ? await this.price(page, selected) : null,
      resultCount: candidates.length,
    }
  }

  private async getPage(input: ConnectionSearchInput) {
    const key = JSON.stringify([
      input.origin,
      input.destination,
      input.travelDate,
      input.departureTime,
      input.onlyDirect,
    ])
    let pending = this.pages.get(key)
    if (!pending) {
      pending = this.loadPage(input)
      this.pages.set(key, pending)
    }
    try {
      return await pending
    } catch (error) {
      this.pages.delete(key)
      throw error
    }
  }

  private async loadPage(input: ConnectionSearchInput): Promise<CdPage> {
    const base = this.options.webBaseUrl ?? env.get('CD_WEB_BASE_URL')
    if (!base)
      throw new ConnectionSearchError('Źródło ČD nie jest skonfigurowane.', 'cdNotConfigured')
    const url = new URL('apiform', base.endsWith('/') ? base : `${base}/`)
    url.searchParams.set('dosearch', 'true')
    url.searchParams.set('f', input.origin)
    url.searchParams.set('t', input.destination)
    url.searchParams.set('date', DateTime.fromISO(input.travelDate).toFormat('dd.LL.yyyy'))
    url.searchParams.set('time', input.departureTime ?? '00:00')
    const { response, cookies } = await this.requestSessionPage(url)
    const html = await response.text()
    const modelText = /^\s*var model = (\{.*\});\r?$/gm.exec(html)?.[1]
    const token = /name="__RequestVerificationToken" type="hidden" value="([^"]+)"/.exec(html)?.[1]
    if (!modelText || !token) {
      throw new ConnectionSearchError('Nie można odczytać publicznych wyników ČD.', 'cdPageInvalid')
    }
    let model: CdPageModel
    try {
      model = JSON.parse(modelText)
    } catch {
      throw new ConnectionSearchError('Nieprawidłowa odpowiedź wyszukiwarki ČD.', 'cdPageInvalid')
    }
    if (!Array.isArray(model.list) || typeof model.guid !== 'string') {
      throw new ConnectionSearchError('Nieprawidłowa lista połączeń ČD.', 'cdPageInvalid')
    }
    return { model, token, cookies }
  }

  private async requestSessionPage(initialUrl: URL) {
    let url = initialUrl
    const cookies = new Map<string, string>()
    const maxRedirects = this.requiredNumber(
      this.options.maxRedirects ?? env.get('CD_WEB_MAX_REDIRECTS'),
      0
    )
    for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
      const response = await this.request(
        url,
        {
          headers: cookies.size ? { cookie: [...cookies.values()].join('; ') } : undefined,
          redirect: 'manual',
        },
        true
      )
      for (const item of response.headers.getSetCookie()) {
        const pair = item.split(';', 1)[0]
        const name = pair.split('=', 1)[0]
        if (name) cookies.set(name, pair)
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) break
        const next = new URL(location, url)
        if (next.origin !== initialUrl.origin) {
          throw new ConnectionSearchError(
            'ČD przekierowało poza witrynę wyszukiwania.',
            'cdRedirectInvalid'
          )
        }
        url = next
        continue
      }
      if (response.ok) return { response, cookies: [...cookies.values()].join('; ') }
      throw new ConnectionSearchError(
        `ČD zwróciło HTTP ${response.status}.`,
        'cdHttpFailed',
        undefined,
        response.status
      )
    }
    throw new ConnectionSearchError('Zbyt wiele przekierowań wyszukiwarki ČD.', 'cdRedirectInvalid')
  }

  private candidates(page: CdPage, input: ConnectionSearchInput) {
    const limit = Math.max(1, env.get('SEARCH_RESULT_LIMIT') ?? 20)
    return page.model.list
      .filter((connection) => {
        const trains = connection.trains
        return (
          Array.isArray(trains) &&
          trains.length > 0 &&
          trains[0].depDate === DateTime.fromISO(input.travelDate).toFormat('dd.LL.yyyy') &&
          (!input.onlyDirect || (trains.length === 1 && (connection.changesCount ?? 0) === 0))
        )
      })
      .slice(0, limit)
  }

  private metadata(connection: CdConnection): ConnectionMetadata {
    const trains = connection.trains!
    const first = trains[0]
    const last = trains.at(-1)!
    const departure = DateTime.fromFormat(`${first.depDate} ${first.depTime}`, 'dd.LL.yyyy HH:mm')
    const arrival = DateTime.fromFormat(`${last.arrDate} ${last.arrTime}`, 'dd.LL.yyyy HH:mm')
    if (!departure.isValid || !arrival.isValid || !first.depTime || !last.arrTime) {
      throw new ConnectionSearchError('Nieprawidłowe godziny połączenia ČD.', 'cdConnectionInvalid')
    }
    const identity = trains.map((train) => [
      train.trainNum,
      train.from,
      train.to,
      train.depDate,
      train.depTime,
      train.arrDate,
      train.arrTime,
    ])
    return {
      uuid: `cd-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 48)}`,
      departure: first.depTime,
      departureMinutes: departure.hour * 60 + departure.minute,
      departureDate: departure.toISODate()!,
      arrival: last.arrTime,
      arrivalDate: arrival.toISODate()!,
      arrivalDateLabel: arrival.toFormat('dd.LL.yyyy'),
      arrivalDayOffset: Math.max(
        0,
        Math.round(arrival.startOf('day').diff(departure.startOf('day'), 'days').days)
      ),
      durationMinutes: Math.max(0, Math.round(arrival.diff(departure, 'minutes').minutes)),
      trains: trains.map((train) => train.trainName || train.trainNum || 'Pociąg ČD').join(' → '),
      changes: connection.changesCount ?? trains.length - 1,
      provider: 'cd',
    }
  }

  private async price(page: CdPage, candidate: CdConnection): Promise<ConnectionResult> {
    const metadata = this.metadata(candidate)
    let pending = this.prices.get(metadata.uuid)
    if (!pending) {
      pending = this.loadPrice(page, candidate, metadata)
      this.prices.set(metadata.uuid, pending)
    }
    try {
      return await pending
    } catch (error) {
      this.prices.delete(metadata.uuid)
      throw error
    }
  }

  private async loadPrice(
    page: CdPage,
    candidate: CdConnection,
    metadata: ConnectionMetadata
  ): Promise<ConnectionResult> {
    const base = this.options.webBaseUrl ?? env.get('CD_WEB_BASE_URL')!
    const url = new URL('GetConnListPrice/', base.endsWith('/') ? base : `${base}/`)
    const body = new URLSearchParams({
      '__RequestVerificationToken': page.token,
      'model[guid]': page.model.guid,
      'model[SearchType]': '0',
      'model[pageType]': String(page.model.pageType),
      'model[priceType]': '0',
      'model[sortType]': '0',
      'model[onlyReservation]': 'false',
      'model[loadPrices][0][connID]': String(candidate.id),
      'model[loadPrices][0][handle]': String(candidate.handle),
      'model[loadPrices][0][auxDesc]': candidate.auxDesc ?? '',
      'model[trainIndex]': '0',
      'model[noCachePrices]': 'true',
    })
    const response = await this.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        'cookie': page.cookies,
      },
      body,
    })
    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw new ConnectionSearchError('Nieprawidłowa odpowiedź cenowa ČD.', 'cdPriceInvalid')
    }
    const rows = (json as { list?: Array<{ id?: number; price?: Record<string, unknown> }> })?.list
    const matching = rows?.find((row) => row.id === candidate.id)
    if (!matching?.price) {
      throw new ConnectionSearchError('ČD nie zwróciło ceny wybranego kursu.', 'cdPriceMissing')
    }
    const offer = matching.price
    const exactPrice =
      typeof offer.price === 'number' &&
      Number.isSafeInteger(offer.price) &&
      offer.price > 0 &&
      !offer.priceFrom &&
      !offer.noPrice &&
      !offer.priceInNextStep
    const availability =
      offer.canProceed === true && offer.soldOut !== true
        ? 'available'
        : offer.soldOut === true || offer.canProceed === false
          ? 'unavailable'
          : 'unknown'
    return {
      ...metadata,
      priceCents: exactPrice ? (offer.price as number) : null,
      purchasable:
        availability === 'available' ? true : availability === 'unavailable' ? false : null,
      ticketAvailability: availability,
      availabilityMessage: exactPrice ? null : 'ČD nie podało dokładnej ceny tego kursu.',
    }
  }

  private async request(url: URL, init?: RequestInit, allowRedirect = false) {
    const timeout = this.requiredNumber(
      this.options.requestTimeoutMs ?? env.get('CD_REQUEST_TIMEOUT_MS'),
      1
    )
    const maxRetries = this.requiredNumber(
      this.options.maxRetries ?? env.get('CD_REQUEST_MAX_RETRIES'),
      0
    )
    const baseDelay = this.requiredNumber(
      this.options.retryBaseDelayMs ?? env.get('CD_REQUEST_RETRY_BASE_DELAY_MS'),
      0
    )
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response
      try {
        response = await fetch(url, {
          ...init,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeout),
        })
      } catch {
        if (attempt < maxRetries) {
          await this.backoff(baseDelay, attempt)
          continue
        }
        throw new ConnectionSearchError('Połączenie z ČD nie powiodło się.', 'cdNetworkFailed')
      }
      if (!response.ok && !(allowRedirect && response.status >= 300 && response.status < 400)) {
        if (
          (response.status === 408 || response.status === 429 || response.status >= 500) &&
          attempt < maxRetries
        ) {
          await this.backoff(baseDelay, attempt)
          continue
        }
        throw new ConnectionSearchError(
          `ČD zwróciło HTTP ${response.status}. Spróbuj ponownie później.`,
          'cdHttpFailed',
          undefined,
          response.status
        )
      }
      return response
    }
    throw new ConnectionSearchError('Połączenie z ČD nie powiodło się.', 'cdNetworkFailed')
  }

  private backoff(baseDelay: number, attempt: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, baseDelay * 2 ** attempt))
  }

  private requiredString(value: string | undefined) {
    if (!value?.trim()) {
      throw new ConnectionSearchError(
        'Konfiguracja źródła ČD jest niekompletna.',
        'cdNotConfigured'
      )
    }
    return value
  }

  private requiredNumber(value: number | undefined, minimum: number) {
    if (value === undefined || !Number.isInteger(value) || value < minimum) {
      throw new ConnectionSearchError(
        'Konfiguracja źródła ČD jest niekompletna.',
        'cdNotConfigured'
      )
    }
    return value
  }
}
