declare module 'open-koleo' {
  export interface KoleoConnectionLeg {
    leg_type?: string
    train_full_name?: string
  }

  export interface KoleoConnection {
    uuid: string
    departure: string
    arrival: string
    changes?: number
    legs?: KoleoConnectionLeg[]
  }

  export interface KoleoPrice {
    price?: string | number
    purchasable?: boolean
    error?: string
  }

  export interface KoleoError {
    error: string
    code?: string
  }

  export interface KoleoClientOptions {
    apiBaseUrl: string
    userAgent: string
    clientName: string
    clientVersion: string
    eolResponseVersion: string
    requestTimeoutMs: number
    maxRetries: number
    retryBaseDelayMs: number
    retryMaxDelayMs: number
    maxConcurrency: number
  }

  export interface KoleoStation {
    id: number
    name: string
    name_slug?: string
    localised_name?: string
    type?: string
  }

  export interface KoleoStationSearch {
    stations?: KoleoStation[]
    error?: string
  }

  export default class Koleo {
    constructor(options?: KoleoClientOptions)
    stations: {
      findStationsByName(name: string): Promise<KoleoStationSearch | KoleoStation[]>
    }
    connections: {
      findConnection(
        origin: string,
        destination: string,
        departureAfter?: string,
        onlyDirect?: boolean
      ): Promise<KoleoConnection[] | KoleoError>
      findConnectionByStationIds(
        originStationId: number,
        destinationStationId: number,
        departureAfter?: string,
        onlyDirect?: boolean
      ): Promise<KoleoConnection[] | KoleoError>
      getConnectionTicketPrice(connectionId: string): Promise<KoleoPrice>
    }
  }
}
