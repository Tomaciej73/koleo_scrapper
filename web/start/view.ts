import edge from 'edge.js'
import { addCollection, edgeIconify } from 'edge-iconify'
import lucideIcons from '@iconify-json/lucide/icons.json' with { type: 'json' }
import { formatPrice, formatPriceWithConversion } from '#services/price_format_service'

edge.use(edgeIconify)
addCollection(lucideIcons)

edge.global('formatPrice', formatPrice)
edge.global('formatPriceWithConversion', formatPriceWithConversion)

edge.global('formatDuration', (durationMinutes: number) => {
  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60
  return `${hours} godz. ${minutes} min`
})
