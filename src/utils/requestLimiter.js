const limiters = new Map();

class RequestLimiter {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  acquire(signal) {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.release.bind(this));
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, abortHandler: undefined };
      if (signal) {
        entry.abortHandler = () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          reject(signal.reason);
        };
        signal.addEventListener('abort', entry.abortHandler, { once: true });
      }
      this.queue.push(entry);
    });
  }

  release() {
    while (this.queue.length) {
      const entry = this.queue.shift();
      entry.signal?.removeEventListener('abort', entry.abortHandler);
      if (entry.signal?.aborted) {
        entry.reject(entry.signal.reason);
        continue;
      }
      entry.resolve(this.release.bind(this));
      return;
    }
    this.active -= 1;
  }
}

export default function requestLimiter(limit) {
  if (!limiters.has(limit)) {
    limiters.set(limit, new RequestLimiter(limit));
  }
  return limiters.get(limit);
}
