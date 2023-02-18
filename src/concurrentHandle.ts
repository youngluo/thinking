type Handle = () => Promise<unknown>

export default function concurrentHandle(handles: Handle[], limit = 6) {
  const n = handles.length
  const results: unknown[] = []
  let i = 0

  return new Promise((resolve) => {
    const request = (fn: Handle, index: number) => {
      if (!fn) return
      fn()
        .then((res) => {
          results[index] = res
        })
        .catch((error) => {
          results[index] = error
        })
        .finally(() => {
          request(handles[i], i)
          i++
          if (results.length === n) {
            resolve(results)
          }
        })
    }

    while (i < limit) {
      request(handles[i], i)
      i++
    }
  })
}
