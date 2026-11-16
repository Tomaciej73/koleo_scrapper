import vine from '@vinejs/vine'

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

export const connectionSearchValidator = vine.create({
  origin: vine.string().trim().minLength(2).maxLength(120),
  destination: vine.string().trim().minLength(2).maxLength(120),
  travelDate: vine.string().regex(datePattern),
  departureTime: vine.string().regex(timePattern).optional(),
  onlyDirect: vine.boolean().optional(),
})

export const priceWatchValidator = vine.create({
  origin: vine.string().trim().minLength(2).maxLength(120),
  destination: vine.string().trim().minLength(2).maxLength(120),
  travelDate: vine.string().regex(datePattern),
  departureTime: vine.string().regex(timePattern),
  arrivalTime: vine.string().regex(timePattern).optional(),
  connectionUuid: vine.string().trim().maxLength(80).optional(),
  trainName: vine.string().trim().maxLength(255).optional(),
  priceCents: vine.number().min(0).optional(),
  targetPrice: vine.number().positive().optional(),
  notificationChannel: vine.enum(['email', 'sms', 'whatsapp'] as const),
  notificationDestination: vine.string().trim().minLength(3).maxLength(254),
})
