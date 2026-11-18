import vine from '@vinejs/vine'

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

export const connectionSearchValidator = vine.create({
  origin: vine.string().trim().minLength(2).maxLength(120),
  originStationId: vine.number().withoutDecimals().positive(),
  destination: vine.string().trim().minLength(2).maxLength(120),
  destinationStationId: vine.number().withoutDecimals().positive(),
  travelDate: vine.string().regex(datePattern),
  departureTime: vine.string().regex(timePattern).optional(),
  onlyDirect: vine.boolean().optional(),
})

export const priceWatchValidator = vine.create({
  origin: vine.string().trim().minLength(2).maxLength(120),
  originStationId: vine.number().withoutDecimals().positive(),
  destination: vine.string().trim().minLength(2).maxLength(120),
  destinationStationId: vine.number().withoutDecimals().positive(),
  travelDate: vine.string().regex(datePattern),
  departureTime: vine.string().regex(timePattern),
  arrivalTime: vine.string().regex(timePattern).optional(),
  arrivalDate: vine.string().regex(datePattern).optional(),
  connectionUuid: vine.string().trim().minLength(1).maxLength(80),
  trainName: vine.string().trim().maxLength(255).optional(),
  priceCents: vine.number().min(0).optional(),
  ticketAvailability: vine.enum(['available', 'unavailable', 'unknown'] as const).optional(),
  availabilityMessage: vine.string().trim().maxLength(500).optional(),
  targetPrice: vine.number().positive().optional(),
  checkIntervalMinutes: vine.number().withoutDecimals().min(1).max(10_080).optional(),
})

export const priceWatchIntervalValidator = vine.create({
  checkIntervalMinutes: vine.number().withoutDecimals().min(1).max(10_080),
})

export const priceWatchSettingsValidator = vine.create({
  targetPrice: vine.number().min(0),
  checkIntervalMinutes: vine.number().withoutDecimals().min(1).max(10_080),
})

export const priceWatchStatusValidator = vine.create({
  status: vine.enum(['active', 'paused'] as const),
})
