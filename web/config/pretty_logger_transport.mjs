import pretty from 'pino-pretty'

// Preserve tabs and newlines while removing control characters that could
// manipulate terminal output. This mirrors pino-pretty's built-in sanitizer.
const unsafeControlCharacters = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

function parseLevelColors(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((colors, entry) => {
      const separatorIndex = entry.indexOf(':')

      if (separatorIndex <= 0) {
        return colors
      }

      const level = entry.slice(0, separatorIndex).trim().toLowerCase()
      const color = entry.slice(separatorIndex + 1).trim()

      if (level && color) {
        colors[level] = color
      }

      return colors
    }, {})
}

function colorizeMessage(colors, colorName, message) {
  const colorizer = colors[colorName]

  return typeof colorizer === 'function' ? colorizer(message) : message
}

function formatTimestamp(timestamp, timeZone, configuredFormat) {
  const format = String(configuredFormat ?? '').replace(/^(SYS|UTC):/, '')
  const effectiveTimeZone = String(configuredFormat ?? '').startsWith('UTC:') ? 'UTC' : timeZone
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: effectiveTimeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(timestamp))
      .map(({ type, value }) => [type, value])
  )

  const values = {
    dd: parts.day,
    mm: parts.month,
    yyyy: parts.year,
    HH: parts.hour,
    MM: parts.minute,
    ss: parts.second,
  }

  return format.replace(/yyyy|dd|mm|HH|MM|ss/g, (token) => values[token] ?? token)
}

function resolveLevelName(log, levelKey) {
  const level = log[levelKey]

  if (typeof level === 'string') {
    return level.toLowerCase()
  }

  return {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
  }[level]
}

export default function createPrettyLoggerTransport(options) {
  const { messageColors, timeFormat, timeZone, ...prettyOptions } = options
  const colorsByLevel = parseLevelColors(messageColors)

  return pretty({
    ...prettyOptions,
    translateTime: false,
    customPrettifiers: {
      ...prettyOptions.customPrettifiers,
      time(timestamp) {
        return `[${formatTimestamp(timestamp, timeZone, timeFormat)}]`
      },
    },
    messageFormat(log, messageKey, _levelLabel, { colors }) {
      const message = String(log[messageKey] ?? '').replace(unsafeControlCharacters, '')
      const level = resolveLevelName(log, prettyOptions.levelKey ?? 'level')
      const colorName = colorsByLevel[level] ?? colorsByLevel.default

      return colorName ? colorizeMessage(colors, colorName, message) : message
    },
  })
}
