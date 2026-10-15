import { useEffect, useState } from 'react'

/** 当前文档的原生性能数据快照，null 表示尚未采到可用值。 */
export type PerformanceSnapshot = {
  fp: number | null
  fcp: number | null
  lcp: number | null
  inp: number | null
  cls: number | null
  ttfb: number | null
  dns: number | null
  connection: number | null
  resourceCount: number
  domContentLoaded: number | null
  loadComplete: number | null
  isInitialized: boolean
}

type PerformanceObserverOptions = PerformanceObserverInit & {
  durationThreshold?: number
}

type PerformanceEntryWithInteraction = PerformanceEntry & {
  interactionId?: number
  hadRecentInput?: boolean
  value?: number
}

const INITIAL_SNAPSHOT: PerformanceSnapshot = {
  fp: null,
  fcp: null,
  lcp: null,
  inp: null,
  cls: null,
  ttfb: null,
  dns: null,
  connection: null,
  resourceCount: 0,
  domContentLoaded: null,
  loadComplete: null,
  isInitialized: false,
}

const CLS_SESSION_GAP = 1000
const CLS_SESSION_LIMIT = 5000

/** 持续采集当前文档的性能数据，INP 仅按已观测交互估算。 */
export const usePerformanceSnapshot = () => {
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT)
  const [supportedEntryTypes, setSupportedEntryTypes] =
    useState<Set<string> | null>(null)

  useEffect(() => {
    let isMounted = true
    let loadTimer: number | undefined
    const observers: PerformanceObserver[] = []
    const current = { ...INITIAL_SNAPSHOT }
    const interactionDurations = new Map<number, number>()
    const supportedTypes = new Set(
      typeof PerformanceObserver === 'undefined'
        ? []
        : (PerformanceObserver.supportedEntryTypes ?? [])
    )

    const commit = () => {
      if (isMounted) {
        setSnapshot({ ...current })
      }
    }

    const updateNavigation = () => {
      const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined

      if (!navigation) {
        return
      }

      current.ttfb = navigation.responseStart
        ? navigation.responseStart - navigation.startTime
        : null
      current.dns = navigation.domainLookupEnd - navigation.domainLookupStart
      current.connection = navigation.connectEnd - navigation.connectStart
      current.domContentLoaded = navigation.domContentLoadedEventEnd
        ? navigation.domContentLoadedEventEnd - navigation.startTime
        : null
      current.loadComplete = navigation.loadEventEnd
        ? navigation.loadEventEnd - navigation.startTime
        : null
    }

    const observe = (
      type: string,
      handleEntries: (entries: PerformanceEntry[]) => void,
      options: PerformanceObserverOptions = {}
    ) => {
      if (
        typeof PerformanceObserver === 'undefined' ||
        !supportedTypes.has(type)
      ) {
        return
      }

      try {
        const observer = new PerformanceObserver((list) => {
          handleEntries(list.getEntries())
          commit()
        })
        observer.observe({ type, buffered: true, ...options })
        observers.push(observer)
        return observer
      } catch {
        // Browsers can list an entry type but still reject its observer options.
        supportedTypes.delete(type)
      }
    }

    for (const entry of performance.getEntriesByType('paint')) {
      if (entry.name === 'first-paint') {
        current.fp = entry.startTime
      }
      if (entry.name === 'first-contentful-paint') {
        current.fcp = entry.startTime
      }
    }

    current.resourceCount = performance.getEntriesByType('resource').length
    updateNavigation()

    observe('paint', (entries) => {
      for (const entry of entries) {
        if (entry.name === 'first-paint') {
          current.fp = entry.startTime
        }
        if (entry.name === 'first-contentful-paint') {
          current.fcp = entry.startTime
        }
      }
    })

    observe('largest-contentful-paint', (entries) => {
      const latestEntry = entries[entries.length - 1]
      if (latestEntry) {
        current.lcp = latestEntry.startTime
      }
    })

    let clsSessionStart: number | null = null
    let clsSessionEnd = 0
    let clsSessionValue = 0

    const clsObserver = observe('layout-shift', (entries) => {
      for (const entry of entries as PerformanceEntryWithInteraction[]) {
        if (entry.hadRecentInput || typeof entry.value !== 'number') {
          continue
        }

        const startsNewSession =
          clsSessionStart === null ||
          entry.startTime - clsSessionEnd >= CLS_SESSION_GAP ||
          entry.startTime - clsSessionStart >= CLS_SESSION_LIMIT

        if (startsNewSession) {
          clsSessionStart = entry.startTime
          clsSessionValue = entry.value
        } else {
          clsSessionValue += entry.value
        }

        clsSessionEnd = entry.startTime
        current.cls = Math.max(current.cls ?? 0, clsSessionValue)
      }
    })

    if (clsObserver) {
      current.cls = 0
    }

    observe(
      'event',
      (entries) => {
        for (const entry of entries as PerformanceEntryWithInteraction[]) {
          if (!entry.interactionId) {
            continue
          }

          const previousDuration = interactionDurations.get(entry.interactionId)
          interactionDurations.set(
            entry.interactionId,
            Math.max(previousDuration ?? 0, entry.duration)
          )
        }

        const durations = Array.from(interactionDurations.values()).sort(
          (a, b) => b - a
        )
        const ignoredSlowInteractions = Math.floor(durations.length / 50)
        current.inp = durations[ignoredSlowInteractions] ?? null
      },
      { durationThreshold: 16 }
    )

    observe('resource', () => {
      current.resourceCount = performance.getEntriesByType('resource').length
    })

    current.isInitialized = true
    setSupportedEntryTypes(supportedTypes)
    commit()

    const handleLoad = () => {
      loadTimer = window.setTimeout(() => {
        updateNavigation()
        commit()
      }, 0)
    }

    if (document.readyState === 'complete') {
      handleLoad()
    } else {
      window.addEventListener('load', handleLoad, { once: true })
    }

    return () => {
      isMounted = false
      window.removeEventListener('load', handleLoad)
      if (loadTimer !== undefined) {
        window.clearTimeout(loadTimer)
      }
      for (const observer of observers) {
        observer.disconnect()
      }
    }
  }, [])

  const isCollecting = Boolean(
    supportedEntryTypes?.size &&
    ['paint', 'largest-contentful-paint', 'event', 'layout-shift'].some(
      (type) => supportedEntryTypes.has(type)
    )
  )

  return { snapshot, supportedEntryTypes, isCollecting }
}
