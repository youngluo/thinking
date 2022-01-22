export function thousands(num: number) {
  let value = num.toString()
  let [int, decimal] = value.split('.')
  let prefix = ''
  if (num < 0) {
    prefix = '-'
    int = int.slice(1)
  }

  let result = ''
  const { length } = int
  for (let i = length - 1; i >= 0; i--) {
    result = int.charAt(i) + result
    if ((length - i) % 3 === 0 && i !== 0) {
      result = ',' + result
    }
  }

  result = prefix + result

  return decimal ? `${result}.${decimal}` : result
}

export function thousandsByReg(num: number) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function thousandsByNative(num: number) {
  return num.toLocaleString()
}
