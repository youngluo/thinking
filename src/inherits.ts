function inherits(subCtor: Function, superCtor: Function) {
  // subCtor.prototype.__proto__ = superCtor.prototype，继承原型方法
  subCtor.prototype = Object.create(superCtor.prototype)
  // 修正构造函数
  subCtor.prototype.constructor = subCtor
  // subCtor.__proto__ = superCtor，继承静态方法和属性
  Object.setPrototypeOf(subCtor, superCtor)
}

function Super(name: string) {
  this.name = name
}

function Sub() {
  // 继承实例属性，可向父类传参
  Super.call(this, 'super')
}

inherits(Sub, Super)
