import JourneyValidationService, {
  JourneyValidationError,
} from '#services/journey_validation_service'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

const validInput = () => ({
  origin: 'Wrocław Główny',
  originStationId: 1,
  destination: 'Olsztyn Główny',
  destinationStationId: 4,
  travelDate: DateTime.now().setZone('Europe/Warsaw').plus({ days: 2 }).toISODate()!,
  departureTime: '14:54',
})

test.group('Journey validation service', () => {
  test('accepts a real future date and station identifiers from suggestions', async () => {
    await new JourneyValidationService().validate(validInput())
  })

  test('rejects a calendar date that does not exist', async ({ assert }) => {
    await assert.rejects(
      () =>
        new JourneyValidationService().validate({
          ...validInput(),
          travelDate: `${DateTime.now().year}-02-30`,
        }),
      JourneyValidationError
    )
  })

  test('rejects the same station and a date beyond the configured sales horizon', async ({
    assert,
  }) => {
    await assert.rejects(
      () =>
        new JourneyValidationService().validate({
          ...validInput(),
          destination: 'Wrocław Główny',
          destinationStationId: 1,
        }),
      /muszą być różne/
    )
    await assert.rejects(
      () =>
        new JourneyValidationService().validate({
          ...validInput(),
          travelDate: DateTime.now().plus({ days: 91 }).toISODate()!,
        }),
      /maksymalnie/
    )
  })

  test('rejects a mismatched station name and identifier', async ({ assert }) => {
    await assert.rejects(
      () =>
        new JourneyValidationService().validate({
          ...validInput(),
          originStationId: 5,
        }),
      /listy podpowiedzi/
    )
  })
})
