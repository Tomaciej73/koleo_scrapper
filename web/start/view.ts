import edge from 'edge.js'
import { addCollection, edgeIconify } from 'edge-iconify'
import lucideIcons from '@iconify-json/lucide/icons.json' with { type: 'json' }

edge.use(edgeIconify)
addCollection(lucideIcons)

edge.global('formatPrice', (priceCents: number | null) => {
  if (priceCents === null || priceCents === undefined) {
    return 'brak ceny'
  }

  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
  }).format(priceCents / 100)
})

edge.global('formatDuration', (durationMinutes: number) => {
  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60
  return `${hours} godz. ${minutes} min`
})
