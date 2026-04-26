type Handle = () => Promise<unknown>

export default function retry(handle: Handle, limit = 3) {
  let count = 0
  return new Promise((resolve, reject) => {
    const run = () => {
      handle()
        .then((res) => {
          resolve(res)
        })
        .catch((error) => {
          if (count++ < limit) {
            run()
          } else {
            reject(error)
          }
        })
    }
    run()
  })
}
