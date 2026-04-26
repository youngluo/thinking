export function sleep(duration = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, duration)
  })
}

export function sleepSync(duration = 0) {
  const previous = Date.now()
  while (Date.now() - previous < duration) {}
}
