export function getParamsByURL(url: string) {
  const { searchParams } = new URL(url)
  return Object.fromEntries(searchParams as any)
}

export function getParamsByURLSearchParams(url: string) {
  const searchParams = new URLSearchParams(url.split('?')[1])
  return Object.fromEntries(searchParams as any)
}

export function getParamsByRepalce(url: string) {
  const params: Record<string, string> = {}
  url.replace(/([^&?]+)=([^&?]+)/g, (match, key, value) => {
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
