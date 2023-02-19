type Handle = () => Promise<unknown>

export function concurrentHandle(handles: Handle[], limit = 6) {
  const n = handles.length
  const results: unknown[] = []
  let i = 0

  return new Promise((resolve) => {
    const run = (fn: Handle, index: number) => {
      if (!fn) return
      fn()
        .then((res) => {
          results[index] = res
        })
        .catch((error) => {
          results[index] = error
        })
        .finally(() => {
          run(handles[i], i)
          i++
          if (results.length === n) {
            resolve(results)
          }
        })
    }

    while (i < limit) {
      run(handles[i], i)
      i++
    }
  })
}
