import StationSearchService from '#services/station_search_service'
import env from '#start/env'
import { DateTime } from 'luxon'

export interface JourneySelection {
  origin: string
  originStationId: number
  destination: string
  destinationStationId: number
  travelDate: string
  departureTime?: string
}

export class JourneyValidationError extends Error {}

export default class JourneyValidationService {
  async validate(input: JourneySelection) {
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'
    const now = DateTime.now().setZone(timezone)
    const travelDate = DateTime.fromFormat(input.travelDate, 'yyyy-MM-dd', {
      zone: timezone,
      setZone: true,
    })

    if (!travelDate.isValid || travelDate.toFormat('yyyy-MM-dd') !== input.travelDate) {
      throw new JourneyValidationError('Podaj prawidłową datę podróży.')
    }

    const today = now.startOf('day')
    const salesEnd = today.plus({ days: env.get('TICKET_SALES_MAX_ADVANCE_DAYS') })
    if (travelDate < today) {
      throw new JourneyValidationError('Data podróży nie może być w przeszłości.')
    }
    if (travelDate > salesEnd) {
      throw new JourneyValidationError(
        `Bilety można wyszukiwać maksymalnie ${env.get('TICKET_SALES_MAX_ADVANCE_DAYS')} dni naprzód.`
      )
    }

    if (input.departureTime !== undefined) {
      const departure = DateTime.fromFormat(
        `${input.travelDate} ${input.departureTime}`,
        'yyyy-MM-dd HH:mm',
        { zone: timezone, setZone: true }
      )
      if (
        !departure.isValid ||
        departure.toFormat('yyyy-MM-dd HH:mm') !== `${input.travelDate} ${input.departureTime}`
      ) {
        throw new JourneyValidationError('Podaj prawidłową godzinę odjazdu.')
      }
      if (departure < now.startOf('minute')) {
        throw new JourneyValidationError('Godzina odjazdu nie może być w przeszłości.')
      }
    }

    if (
      input.originStationId === input.destinationStationId ||
      this.normalize(input.origin) === this.normalize(input.destination)
    ) {
      throw new JourneyValidationError('Stacje początkowa i końcowa muszą być różne.')
    }

    const stations = new StationSearchService()
    await Promise.all([
      this.validateStation(stations, input.origin, input.originStationId, 'początkową'),
      this.validateStation(stations, input.destination, input.destinationStationId, 'końcową'),
    ])
  }

  private async validateStation(
    service: StationSearchService,
    name: string,
    stationId: number,
    label: string
  ) {
    const matches = await service.search(name)
    const exact = matches.some(
      (station) => station.id === stationId && this.normalize(station.name) === this.normalize(name)
    )
    if (!exact) {
      throw new JourneyValidationError(
        `Wybierz stację ${label} z listy podpowiedzi zamiast wpisywać dowolny tekst.`
      )
    }
  }

  private normalize(value: string) {
    return value
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pl-PL')
      .replaceAll('ł', 'l')
      .trim()
  }
}
