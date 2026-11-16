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

Alpine.data('stationAutocomplete', function () {
  return {
    query: '',
    stations: [],
    open: false,
    loading: false,
    searched: false,
    activeIndex: -1,
    timer: undefined,
    controller: undefined,
    requestNumber: 0,
    endpoint: '',
    fieldName: '',
    minimumLength: 2,

    init() {
      this.query = this.$refs.input.value
      this.endpoint = this.$el.dataset.endpoint
      this.fieldName = this.$el.dataset.field
      this.minimumLength = Number(this.$el.dataset.minLength || 2)
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
      this.stations = []
      this.searched = false
      this.close()
      this.$nextTick(() => this.$refs.input.focus())
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

Alpine.start()
