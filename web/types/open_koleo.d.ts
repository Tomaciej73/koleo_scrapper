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

  export default class Koleo {
    connections: {
      findConnection(
        origin: string,
        destination: string,
        departureAfter?: string,
        onlyDirect?: boolean
      ): Promise<KoleoConnection[] | KoleoError>
      getConnectionTicketPrice(connectionId: string): Promise<KoleoPrice>
    }
  }
}
