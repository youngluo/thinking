type EventListener = (...args: unknown[]) => void

export default class EventEmitter {
  listeners = new Map<string, EventListener[]>()

  emit(eventName: string, ...args: unknown[]) {
    const listeners = this.listeners.get(eventName)
    if (!listeners || listeners.length === 0) {
      console.warn(`the ${eventName} listener does not exist`)
      return
    }
    listeners.forEach((fn) => {
      fn(...args)
    })
  }

  on(eventName: string, listener: EventListener) {
    if (typeof listener !== 'function') throw new Error('listener must be a function')
    const listeners = this.listeners.get(eventName) || []
    listeners.push(listener)
    this.listeners.set(eventName, listeners)
  }

  off(eventName: string, listener?: EventListener) {
    if (!this.listeners.has(eventName)) return
    if (!listener) {
      this.listeners.delete(eventName)
    } else {
      const listeners = this.listeners.get(eventName)!.filter((fn) => fn !== listener)
      if (listeners.length === 0) {
        this.listeners.delete(eventName)
      } else {
        this.listeners.set(eventName, listeners)
      }
    }
  }

  once(eventName: string, listener: EventListener) {
    if (typeof listener !== 'function') throw new Error('listener must be a function')
    const fn = (...args: any[]) => {
      listener(...args)
      this.off(eventName, fn)
    }
    this.on(eventName, fn)
  }
}
