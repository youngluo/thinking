import { usePerformanceSnapshot } from './usePerformanceSnapshot'
import './index.css'

type MetricKey = 'fp' | 'fcp' | 'lcp' | 'inp' | 'cls'

type MetricDefinition = {
  key: MetricKey
  label: string
  description: string
  entryType: string
  thresholds?: readonly [number, number]
  format: 'duration' | 'score'
}

const EXPERIENCE_METRICS: MetricDefinition[] = [
  {
    key: 'lcp',
    label: 'LCP',
    description: '最大内容绘制候选',
    entryType: 'largest-contentful-paint',
    thresholds: [2500, 4000],
    format: 'duration',
  },
  {
    key: 'inp',
    label: 'INP 估算',
    description: '已观测交互的延迟估算',
    entryType: 'event',
    thresholds: [200, 500],
    format: 'duration',
  },
  {
    key: 'cls',
    label: 'CLS',
    description: '最大布局偏移会话',
    entryType: 'layout-shift',
    thresholds: [0.1, 0.25],
    format: 'score',
  },
]

const PAINT_METRICS: MetricDefinition[] = [
  {
    key: 'fp',
    label: 'FP',
    description: '首次绘制',
    entryType: 'paint',
    format: 'duration',
  },
  {
    key: 'fcp',
    label: 'FCP',
    description: '首次内容绘制',
    entryType: 'paint',
    thresholds: [1800, 3000],
    format: 'duration',
  },
]

const NAVIGATION_METRICS = [
  { key: 'ttfb', label: 'TTFB', description: '导航开始到首字节' },
  { key: 'dns', label: 'DNS', description: '域名查找耗时' },
  { key: 'connection', label: '连接建立', description: '可能包含 TLS 握手' },
] as const

function formatMetricValue(
  value: number | null,
  format: MetricDefinition['format']
) {
  if (value === null) {
    return { value: '--', unit: '' }
  }

  if (format === 'score') {
    return { value: value.toFixed(3), unit: '' }
  }

  if (value < 1000) {
    return { value: String(Math.round(value)), unit: 'ms' }
  }

  return { value: (value / 1000).toFixed(2), unit: 's' }
}

function getMetricStatus(
  metric: MetricDefinition,
  value: number | null,
  isSupported: boolean,
  isInitialized: boolean
) {
  if (value === null) {
    if (!isInitialized) {
      return { label: '读取中', tone: 'pending' }
    }

    return isSupported
      ? { label: '暂无数据', tone: 'pending' }
      : { label: '不支持', tone: 'unsupported' }
  }

  if (!metric.thresholds) {
    return { label: '已采集', tone: 'neutral' }
  }

  if (value <= metric.thresholds[0]) {
    return { label: '良好', tone: 'good' }
  }

  if (value <= metric.thresholds[1]) {
    return { label: '需关注', tone: 'warning' }
  }

  return { label: '偏高', tone: 'poor' }
}

type MetricValueProps = {
  value: number | null
  format?: MetricDefinition['format']
  isLoading?: boolean
}

const MetricValue = (props: MetricValueProps) => {
  const { value, format = 'duration', isLoading = false } = props
  const formattedValue = formatMetricValue(value, format)

  return (
    <strong
      className="performance-demo__metric-value"
      aria-label={isLoading ? '读取中' : undefined}
    >
      {isLoading ? (
        <span className="performance-demo__skeleton" aria-hidden="true" />
      ) : (
        <>
          {formattedValue.value}
          {formattedValue.unit && (
            <span className="performance-demo__metric-unit">
              {formattedValue.unit}
            </span>
          )}
        </>
      )}
    </strong>
  )
}

MetricValue.displayName = 'MetricValue'

type PerformanceMetricProps = {
  metric: MetricDefinition
  value: number | null
  isSupported: boolean
  isInitialized: boolean
}

const PerformanceMetric = (props: PerformanceMetricProps) => {
  const { metric, value, isSupported, isInitialized } = props
  const status = getMetricStatus(metric, value, isSupported, isInitialized)

  return (
    <article className="performance-demo__metric">
      <div className="performance-demo__metric-heading">
        <span className="performance-demo__metric-label">{metric.label}</span>
        <span
          className={`performance-demo__metric-status performance-demo__metric-status--${status.tone}`}
        >
          {status.label}
        </span>
      </div>
      <MetricValue
        value={value}
        format={metric.format}
        isLoading={!isInitialized}
      />
      <span className="performance-demo__metric-description">
        {metric.description}
      </span>
    </article>
  )
}

PerformanceMetric.displayName = 'PerformanceMetric'

/** 在文档中展示当前浏览器的原生性能数据。 */
const PerformanceDemo = () => {
  const { snapshot, supportedEntryTypes, isCollecting } =
    usePerformanceSnapshot()
  const statusLabel =
    supportedEntryTypes === null
      ? '正在读取'
      : isCollecting
        ? '实时采集中'
        : '浏览器支持有限'

  return (
    <section className="performance-demo" aria-label="当前文档实时性能数据">
      <header className="performance-demo__header">
        <h4 className="performance-demo__title">当前文档性能</h4>
        <span
          className={`performance-demo__status${isCollecting ? ' performance-demo__status--live' : ''}`}
          aria-live="polite"
        >
          {statusLabel}
        </span>
      </header>
      <p className="performance-demo__intro">
        交互与布局数据实时更新，站内路由切换沿用首次导航数据。
      </p>

      <div className="performance-demo__experience" aria-label="核心体验指标">
        {EXPERIENCE_METRICS.map((metric) => (
          <PerformanceMetric
            key={metric.key}
            metric={metric}
            value={snapshot[metric.key]}
            isSupported={supportedEntryTypes?.has(metric.entryType) ?? false}
            isInitialized={snapshot.isInitialized}
          />
        ))}
      </div>

      <div className="performance-demo__details">
        <section
          className="performance-demo__detail-group"
          aria-label="内容绘制"
        >
          <h5 className="performance-demo__section-title">内容绘制</h5>
          {PAINT_METRICS.map((metric) => (
            <PerformanceMetric
              key={metric.key}
              metric={metric}
              value={snapshot[metric.key]}
              isSupported={supportedEntryTypes?.has(metric.entryType) ?? false}
              isInitialized={snapshot.isInitialized}
            />
          ))}
        </section>
        <section
          className="performance-demo__detail-group"
          aria-label="页面导航"
        >
          <h5 className="performance-demo__section-title">页面导航</h5>
          <dl className="performance-demo__navigation">
            {NAVIGATION_METRICS.map((metric) => (
              <div
                className="performance-demo__navigation-metric"
                key={metric.key}
              >
                <dt>
                  <span className="performance-demo__metric-label">
                    {metric.label}
                  </span>
                  <span className="performance-demo__metric-description">
                    {metric.description}
                  </span>
                </dt>
                <dd>
                  <MetricValue
                    value={snapshot[metric.key]}
                    isLoading={!snapshot.isInitialized}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <footer className="performance-demo__footer">
        <span>
          资源记录数 <strong>{snapshot.resourceCount}</strong>
        </span>
        <span>
          DOMContentLoaded <MetricValue value={snapshot.domContentLoaded} />
        </span>
        <span>
          Load <MetricValue value={snapshot.loadComplete} />
        </span>
      </footer>

      <details className="performance-demo__note">
        <summary
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // 避免 Rspress 搜索组件的全局回车处理接管此操作。
              event.stopPropagation()
            }
          }}
        >
          数据说明
          <span>单次文档数据，仅供参考</span>
        </summary>
        <p>
          INP 按已观测交互估算，低于 16ms
          的交互可能未被采集；「暂无数据」不代表未交互。 CLS
          按会话窗口计算。Core Web Vitals 建议用 <code>web-vitals</code>
          计算，并按真实访问的第 75 百分位评估。
        </p>
      </details>
    </section>
  )
}

PerformanceDemo.displayName = 'PerformanceDemo'

export { PerformanceDemo }
