function swap(array: number[], i: number, j: number) {
  ;[array[i], array[j]] = [array[j], array[i]]
}

export function bubblingSort(array: number[]) {
  for (let i = 0; i < array.length; i++) {
    for (let j = i + 1; j < array.length; j++) {
      if (array[i] > array[j]) swap(array, i, j)
    }
  }
  return array
}

export function selectSorted(array: number[]) {
  for (let i = 0; i < array.length; i++) {
    let min = i
    for (let j = i + 1; j < array.length; j++) {
      if (array[min] > array[j]) min = j
    }
    if (min !== i) swap(array, min, i)
  }
  return array
}

export function insertOrder(array: number[]) {
  for (let i = 1; i < array.length; i++) {
    let v = array[i]
    let j = i
    while (j > 0) {
      if (v >= array[j - 1]) break
      array[j] = array[j - 1]
      j--
    }
    array[j] = v
  }
  return array
}

function getPrivot(array: number[], left: number, right: number) {
  let l = left
  let r = right
  while (l < r) {
    // 右侧扫描
    while (l < r && array[l] <= array[r]) r--
    if (l < r) {
      swap(array, l, r)
      l++
    }
    // 左侧扫描
    while (l < r && array[l] <= array[r]) l++
    if (l < r) {
      swap(array, l, r)
      r--
    }
  }
  return l
}

export function quickSort(array: number[], left: number, right: number) {
  if (left < right) {
    const privot = getPrivot(array, left, right)
    quickSort(array, left, privot - 1)
    quickSort(array, privot + 1, right)
  }
  return array
}
