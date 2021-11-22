import EventEmitter from '../lib/index'

const eventEmitter = new EventEmitter()

describe('@thinking/event-emitter', () => {
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
})
