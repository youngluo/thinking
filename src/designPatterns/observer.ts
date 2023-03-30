/**
 * 观察者模式定义了对象间一对多的依赖关系，当一个对象（目标对象）的状态发生改变时，
 * 所有依赖于它的对象（观察者）都将得到通知，并自动更新
 */
/**
 * 观察者
 */
class Observer {
  name: string

  constructor(name: string) {
    this.name = name
  }

  update() {
    console.log(this.name)
  }
}
/**
 * 目标对象
 */
class Subject {
  observers: Observer[] = []

  add(observer: Observer) {
    this.observers.push(observer)
  }

  delete(observer: Observer) {
    this.observers.filter((o) => o !== observer)
  }

  notify() {
    this.observers.forEach((observer) => {
      observer.update()
    })
  }
}

const subject = new Subject()
const observer1 = new Observer('1')
const observer2 = new Observer('2')

subject.add(observer1)
subject.add(observer2)

subject.notify()
