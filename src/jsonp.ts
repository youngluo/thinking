export default function jsonp(url: string, params: {}) {
  return new Promise((resolve, reject) => {
    const jsonpName = `jsonp_${new Date().getTime()}`
    const script = document.createElement('script')
    script.src = `${url}?callback=${jsonpName}`
    document.appendChild(script)

    window[jsonpName] = (response) => {
      resolve(response)
      delete window[jsonpName]
      document.removeChild(script)
    }

    script.onerror = (e) => {
      reject(e)
      delete window[jsonpName]
      document.removeChild(script)
    }
  })
}
