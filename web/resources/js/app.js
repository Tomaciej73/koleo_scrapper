import Alpine from 'alpinejs'

Alpine.data('alert', function () {
  return {
    isVisible: false,
    dismiss() {
      this.isVisible = false
    },
    init() {
      setTimeout(() => {
        this.isVisible = true
      }, 80)
      setTimeout(() => {
        this.dismiss()
      }, 5000)
    },
  }
})

Alpine.data('themeToggle', function () {
  return {
    theme: 'light',
    init() {
      this.theme = this.$el.dataset.initialTheme || 'light'
    },
    toggle() {
      const next = this.theme === 'dark' ? 'light' : 'dark'
      this.theme = next
      document.documentElement.setAttribute('data-theme', next)
      document.cookie = `app_theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    },
  }
})

Alpine.data('journeySearch', function () {
  return {
    submitting: false,

    stationValue(fieldName) {
      const field = this.$root.querySelector(`[data-field="${fieldName}"]`)
      return {
        name: field?.querySelector('input[type="text"]')?.value ?? '',
        id: field?.querySelector('[data-station-id]')?.value ?? '',
      }
    },

    swapStations() {
      const origin = this.stationValue('origin')
      const destination = this.stationValue('destination')
      window.dispatchEvent(
        new CustomEvent('journey-stations-swapped', {
          detail: { origin: destination, destination: origin },
        })
      )
    },

    handleSubmit(event) {
      const invalidInput = [...this.$root.querySelectorAll('[data-field]')]
        .map((field) => ({
          input: field.querySelector('input[type="text"]'),
          stationId: field.querySelector('[data-station-id]')?.value,
        }))
        .find((field) => !field.stationId)

      if (invalidInput?.input) {
        event.preventDefault()
        invalidInput.input.setCustomValidity('Wybierz stację z listy podpowiedzi.')
        invalidInput.input.reportValidity()
        invalidInput.input.focus()
        return
      }

      this.submitting = true
    },
  }
})

Alpine.data('stationAutocomplete', function () {
  return {
    query: '',
    stationId: '',
    selectedName: '',
    stations: [],
    open: false,
    loading: false,
    searched: false,
    activeIndex: -1,
    timer: undefined,
    controller: undefined,
    requestNumber: 0,
    errorMessage: '',
    endpoint: '',
    fieldName: '',
    minimumLength: 2,

    init() {
      this.query = this.$refs.input.value
      this.stationId = this.$el.dataset.selectedId || ''
      this.selectedName = this.stationId ? this.query : ''
      this.endpoint = this.$el.dataset.endpoint
      this.fieldName = this.$el.dataset.field
      this.minimumLength = Number(this.$el.dataset.minLength || 2)
    },

    onInput() {
      if (this.query !== this.selectedName) {
        this.stationId = ''
      }
      this.$refs.input.setCustomValidity('')
      this.queueSearch()
    },

    queueSearch() {
      window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.search(), 250)
    },

    openResults() {
      if (this.stations.length || this.searched) {
        this.open = true
      } else if (this.query.trim().length >= this.minimumLength) {
        void this.search()
      }
    },

    async search() {
      const query = this.query.trim()
      if (query.length < this.minimumLength) {
        this.controller?.abort()
        this.stations = []
        this.searched = false
        this.loading = false
        this.close()
        return
      }

      this.controller?.abort()
      this.controller = new AbortController()
      const currentRequest = ++this.requestNumber
      this.loading = true
      this.searched = false
      this.errorMessage = ''

      try {
        const params = new URLSearchParams({ q: query })
        const response = await fetch(`${this.endpoint}?${params.toString()}`, {
          headers: { Accept: 'application/json' },
          signal: this.controller.signal,
        })
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.message || 'Station search failed')
        }

        if (currentRequest !== this.requestNumber) {
          return
        }

        this.stations = Array.isArray(data.stations) ? data.stations : []
        this.activeIndex = this.stations.length ? 0 : -1
        this.searched = true
        this.open = true
      } catch (error) {
        if (error.name !== 'AbortError' && currentRequest === this.requestNumber) {
          this.stations = []
          this.activeIndex = -1
          this.searched = true
          this.open = true
          this.errorMessage = 'Nie udało się pobrać listy stacji. Spróbuj ponownie.'
        }
      } finally {
        if (currentRequest === this.requestNumber) {
          this.loading = false
        }
      }
    },

    move(direction) {
      if (!this.open) {
        this.openResults()
        return
      }
      if (!this.stations.length) {
        return
      }

      this.activeIndex =
        (this.activeIndex + direction + this.stations.length) % this.stations.length
    },

    chooseActive(event) {
      if (!this.open || this.activeIndex < 0 || !this.stations[this.activeIndex]) {
        return
      }
      event.preventDefault()
      this.select(this.stations[this.activeIndex])
    },

    select(station) {
      this.query = station.name
      this.stationId = String(station.id)
      this.selectedName = station.name
      this.$refs.input.setCustomValidity('')
      this.stations = []
      this.searched = false
      this.close()
      this.$nextTick(() => this.$refs.input.focus())
    },

    applyExternalValue(values) {
      const value = values?.[this.fieldName]
      if (!value) {
        return
      }

      this.query = value.name
      this.stationId = String(value.id || '')
      this.selectedName = this.stationId ? value.name : ''
      this.stations = []
      this.searched = false
      this.close()
    },

    close() {
      this.open = false
      this.activeIndex = -1
    },

    optionId(index) {
      return `${this.fieldName}-station-option-${index}`
    },

    get activeOptionId() {
      return this.activeIndex >= 0 ? this.optionId(this.activeIndex) : undefined
    },
  }
})

Alpine.data('connectionResults', function () {
  return {
    sortKey: 'departure',

    sortResults() {
      const list = this.$refs.list
      if (!list) {
        return
      }

      const cards = [...list.querySelectorAll('.connection-card')]
      cards.sort((left, right) => {
        const leftValue = Number(left.dataset[`${this.sortKey}Sort`])
        const rightValue = Number(right.dataset[`${this.sortKey}Sort`])
        const primary = leftValue - rightValue
        if (primary !== 0) {
          return primary
        }
        return Number(left.dataset.departureSort) - Number(right.dataset.departureSort)
      })
      cards.forEach((card) => list.append(card))
    },
  }
})

Alpine.data('submittingForm', function () {
  return {
    submitting: false,

    handleSubmit(event) {
      const message = this.$root.dataset.confirm
      if (message && !window.confirm(message)) {
        event.preventDefault()
        return
      }
      this.submitting = true
    },
  }
})

Alpine.data('verificationCode', function () {
  return {
    digits: [],
    length: 6,
    submitting: false,

    init() {
      this.length = Number(this.$root.dataset.codeLength || 6)
      this.digits = Array.from({ length: this.length }, () => '')
      this.$nextTick(() => this.inputAt(0)?.focus())
    },

    inputAt(index) {
      return this.$root.querySelector(`[data-code-index="${index}"]`)
    },

    handleInput(index, event) {
      const digit = event.target.value.replace(/\D/g, '').slice(-1)
      this.digits[index] = digit
      event.target.value = digit
      if (digit && index < this.length - 1) {
        this.inputAt(index + 1)?.focus()
      }
    },

    handleKeydown(index, event) {
      if (event.key === 'Backspace' && !this.digits[index] && index > 0) {
        this.inputAt(index - 1)?.focus()
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault()
        this.inputAt(index - 1)?.focus()
      }
      if (event.key === 'ArrowRight' && index < this.length - 1) {
        event.preventDefault()
        this.inputAt(index + 1)?.focus()
      }
    },

    handlePaste(event) {
      const pastedDigits = event.clipboardData
        .getData('text')
        .replace(/\D/g, '')
        .slice(0, this.length)
      if (!pastedDigits) {
        return
      }

      event.preventDefault()
      pastedDigits.split('').forEach((digit, index) => {
        this.digits[index] = digit
        const input = this.inputAt(index)
        if (input) {
          input.value = digit
        }
      })
      this.inputAt(Math.min(pastedDigits.length, this.length) - 1)?.focus()
    },

    handleSubmit(event) {
      const code = this.digits.join('')
      if (code.length !== this.length) {
        event.preventDefault()
        this.inputAt(this.digits.findIndex((digit) => !digit))?.focus()
        return
      }

      this.$refs.code.value = code
      this.submitting = true
    },
  }
})

Alpine.data('resendCountdown', function () {
  return {
    seconds: 0,
    timer: undefined,
    submitting: false,

    init() {
      this.seconds = Math.max(0, Number(this.$root.dataset.seconds || 0))
      if (this.seconds > 0) {
        this.timer = window.setInterval(() => {
          this.seconds = Math.max(0, this.seconds - 1)
          if (this.seconds === 0) {
            window.clearInterval(this.timer)
          }
        }, 1000)
      }
    },

    destroy() {
      window.clearInterval(this.timer)
    },
  }
})

Alpine.start()
