type EventListener = () => void

export default class EventEmitter {
  listeners = new Map<string, EventListener[]>()

  emit(eventName: string) {
    const listeners = this.listeners.get(eventName)
    if (!listeners || listeners.length === 0) return
    listeners.forEach((listener) => {
      listener()
    })
  }

  on(eventName: string, listener: EventListener) {
    const listeners = this.listeners.get(eventName)
    if (!listeners || listeners.length === 0) {
      this.listeners.set(eventName, [listener])
      return
    }

    listeners.push(listener)
    this.listeners.set(eventName, listeners)
  }

  off(eventName: string) {
    this.listeners.delete(eventName)
  }
}
