<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const perfData = ref({
  fp: '—', fcp: '—', lcp: '—', inp: '—', cls: '—',
  ttfb: '—', dns: '—', tcp: '—'
})
let po = null

onMounted(() => {
  // Navigation Timing（同步获取）
  const nav = performance.getEntriesByType('navigation')[0]
  if (nav) {
    perfData.value.ttfb = (nav.responseStart - nav.requestStart).toFixed(2) + ' ms'
    perfData.value.dns = (nav.domainLookupEnd - nav.domainLookupStart).toFixed(2) + ' ms'
    perfData.value.tcp = (nav.connectEnd - nav.connectStart).toFixed(2) + ' ms'
  }

  // Performance Observer（异步监听）
  po = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'paint') {
        if (entry.name === 'first-paint') perfData.value.fp = entry.startTime.toFixed(2) + ' ms'
        if (entry.name === 'first-contentful-paint') perfData.value.fcp = entry.startTime.toFixed(2) + ' ms'
      }
      if (entry.entryType === 'largest-contentful-paint') {
        perfData.value.lcp = entry.startTime.toFixed(2) + ' ms'
      }
      if (entry.entryType === 'event') {
        const duration = entry.processingStart + entry.duration - entry.startTime
        const prev = perfData.value.inp === '—' ? 0 : parseFloat(perfData.value.inp)
        if (duration > prev) perfData.value.inp = duration.toFixed(2) + ' ms'
      }
      if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
        const prev = perfData.value.cls === '—' ? 0 : parseFloat(perfData.value.cls)
        perfData.value.cls = (prev + entry.value).toFixed(4)
      }
    }
  })

  po.observe({ entryTypes: ['paint', 'largest-contentful-paint', 'event', 'layout-shift'], buffered: true })
})

onUnmounted(() => {
  po?.disconnect()
})
</script>

<template>
  <div class="perf-table">
    <div class="perf-row"><span>FP</span><span>{{ perfData.fp }}</span></div>
    <div class="perf-row"><span>FCP</span><span>{{ perfData.fcp }}</span></div>
    <div class="perf-row"><span>LCP</span><span>{{ perfData.lcp }}</span></div>
    <div class="perf-row"><span>INP</span><span>{{ perfData.inp }}</span></div>
    <div class="perf-row"><span>CLS</span><span>{{ perfData.cls }}</span></div>
    <div class="perf-row"><span>TTFB</span><span>{{ perfData.ttfb }}</span></div>
    <div class="perf-row"><span>DNS</span><span>{{ perfData.dns }}</span></div>
    <div class="perf-row"><span>TCP</span><span>{{ perfData.tcp }}</span></div>
  </div>
</template>

<style scoped>
.perf-table {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  overflow: hidden;
  font-family: monospace;
  font-size: 0.9rem;
}
.perf-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid #e5e7eb;
}
.perf-row:last-child { border-bottom: none; }
.perf-row span:first-child { color: #6b7280; }
.perf-row span:last-child { font-weight: 600; }
</style>
