import EventEmitter from '../designPatterns/eventEmitter'

const eventEmitter = new EventEmitter()

describe('event-emitter', () => {
  test('should emit ping listener', () => {
    const listener = jest.fn()
    eventEmitter.on('ping', listener)
    eventEmitter.emit('ping')
    expect(listener).toHaveBeenCalled()
  })

  test('should remove ping listener', () => {
    eventEmitter.off('ping')
    expect(eventEmitter.listeners.size).toBe(0)
  })

  test('should emit ping listener with the "1, 2" arguments', () => {
    const listener = jest.fn()
    eventEmitter.on('ping', listener)
    eventEmitter.emit('ping', 1, 2)
    expect(listener).toHaveBeenCalledWith(1, 2)
  })

  test('should emit ping listener once', () => {
    eventEmitter.off('ping')
    const listener = jest.fn()
    eventEmitter.once('ping', listener)
    eventEmitter.emit('ping')
    expect(listener).toHaveBeenCalled()
    expect(eventEmitter.listeners.size).toBe(0)
  })
})
