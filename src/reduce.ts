const isUndefined = (v: any) => typeof v === 'undefined'

export default function reduce<T>(
  array: T[],
  callback: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T,
  initialValue?: T
) {
  const { length } = array
  if (length === 0 && isUndefined(initialValue)) {
    throw new Error('Reduce of empty array with no initial value')
  }

  let pre = initialValue ?? array[0]
  let i = isUndefined(initialValue) ? 1 : 0

  for (i; i < length; i++) {
    pre = callback(pre, array[i], i, array)
  }

  return pre
}

const array = ['1']

// console.log(
//   array.reduce((a, b, i, arr) => {
//     console.log('==1===', a, b, i, arr)
//     return b
//   }, 0)
// )

console.log(
  reduce(
    array,
    (a, b, i, arr) => {
      console.log('==2===', a, b, i, arr)
      return a
    },
    0
  )
)
