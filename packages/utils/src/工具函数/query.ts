export function getParamsByURL(url: string) {
  const { searchParams } = new URL(url)
  return Object.fromEntries(
    searchParams as unknown as Iterable<[string, string]>
  )
}

export function getParamsByURLSearchParams(url: string) {
  const searchParams = new URLSearchParams(url.split('?')[1])
  return Object.fromEntries(
    searchParams as unknown as Iterable<[string, string]>
  )
}

export function getParamsByRepalce(url: string) {
  const params: Record<string, string> = {}
  url.replace(/([^&?]+)=([^&?]+)/g, (_match, key, value) => {
    params[key] = value
    return value
  })
  return params
}

export function getParamsByMatchAll(url: string) {
  const params: Record<string, string> = {}
  const iterator = url.matchAll(/([^&?]+)=([^&?]+)/g)
  for (const [, k, v] of iterator) {
    params[k] = v
  }
  return params
}
