import { useMemo } from 'react'
import type { FC } from 'react'
import './index.css'

type TrailTone =
  | 'blue'
  | 'cyan'
  | 'emerald'
  | 'green'
  | 'indigo'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'teal'
  | 'yellow'
type TrailSize = 'sm' | 'md' | 'lg'

type TrailCloudProps = {
  trails: readonly string[]
}

type TrailFloat = 'down' | 'up'

type TrailMotion = {
  delay: string
  duration: string
  float: TrailFloat
  layer: number
  transform: string
}

type TrailPosition = {
  x: number
  y: number
}

const SEED = 47
const TONES: readonly TrailTone[] = [
  'blue',
  'cyan',
  'emerald',
  'green',
  'indigo',
  'orange',
  'pink',
  'purple',
  'red',
  'teal',
  'yellow',
]
const SIZES: readonly TrailSize[] = ['sm', 'md', 'md', 'lg']

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const getLabelSeed = (label: string) => {
  return Array.from(label).reduce(
    (seed, char) => seed + char.charCodeAt(0),
    SEED
  )
}

const getSeededRatio = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + SEED * 78.233) * 43758.5453
  return value - Math.floor(value)
}

const getTrailOrder = (count: number) => {
  return Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => getSeededRatio(a + 1) - getSeededRatio(b + 1)
  )
}

const getPositionDistance = (
  position: TrailPosition,
  selectedPositions: readonly TrailPosition[]
) => {
  if (selectedPositions.length === 0) {
    return 100
  }

  return selectedPositions.reduce((nearestDistance, selectedPosition) => {
    const xDistance = position.x - selectedPosition.x
    const yDistance = (position.y - selectedPosition.y) * 1.45
    const distance = Math.hypot(xDistance, yDistance)

    return Math.min(nearestDistance, distance)
  }, Number.POSITIVE_INFINITY)
}

const getPositionCenterWeight = (position: TrailPosition) => {
  const xDistance = Math.abs(position.x - 50) / 50
  const yDistance = Math.abs(position.y - 50) / 50

  return 1 - Math.max(xDistance, yDistance) * 0.18
}

const getTrailPositions = (
  trailCount: number,
  trailOrder: readonly number[]
) => {
  const candidateCount = Math.max(trailCount * 9, 120)
  const selectedPositions: TrailPosition[] = []
  const positions: TrailPosition[] = Array.from({ length: trailCount })

  const candidates = Array.from({ length: candidateCount }, (_, index) => {
    const seed = trailOrder[index % trailOrder.length] + index * 131
    const x = 6 + getSeededRatio(seed + 101) * 88
    const y = 9 + getSeededRatio(seed + 102) * 82

    return {
      x,
      y,
    }
  })

  trailOrder.forEach((trailIndex, orderIndex) => {
    const bestCandidate = candidates.reduce((bestPosition, candidate) => {
      const candidateScore =
        getPositionDistance(candidate, selectedPositions) *
          getPositionCenterWeight(candidate) +
        getSeededRatio(trailIndex + orderIndex * 17 + 301) * 0.72
      const bestScore =
        getPositionDistance(bestPosition, selectedPositions) *
          getPositionCenterWeight(bestPosition) +
        getSeededRatio(trailIndex + orderIndex * 17 + 302) * 0.72

      return candidateScore > bestScore ? candidate : bestPosition
    })

    selectedPositions.push(bestCandidate)
    positions[trailIndex] = bestCandidate
    candidates.splice(candidates.indexOf(bestCandidate), 1)
  })

  return positions
}

const getTrailMotion = (
  index: number,
  labelSeed: number,
  position: TrailPosition
): TrailMotion => {
  const float: TrailFloat =
    getSeededRatio(labelSeed + index + 21) > 0.5 ? 'down' : 'up'
  const duration = 6.4 + getSeededRatio(labelSeed + index + 41) * 1.8
  const delay = -getSeededRatio(labelSeed + index + 51) * 4.8
  const layer = 1 + Math.floor(getSeededRatio(labelSeed + index + 61) * 6)

  return {
    delay: `${delay.toFixed(1)}s`,
    duration: `${duration.toFixed(1)}s`,
    float,
    layer,
    transform: [
      `translate3d(clamp(0px, calc(${position.x.toFixed(2)}cqw - 50%), calc(100cqw - 100%)),`,
      `clamp(0px, calc(${position.y.toFixed(2)}cqh - 50%), calc(100cqh - 100%)), 0)`,
    ].join(' '),
  }
}

const getTrailTone = (labelSeed: number, index: number) => {
  return TONES[
    Math.floor(getSeededRatio(labelSeed + index + 71) * TONES.length)
  ]
}

const getTrailSize = (labelSeed: number, index: number) => {
  return SIZES[
    Math.floor(getSeededRatio(labelSeed + index + 81) * SIZES.length)
  ]
}

export const TrailCloud: FC<TrailCloudProps> = (props) => {
  const { trails } = props
  const trailItems = useMemo(() => {
    const trailOrder = getTrailOrder(trails.length)
    const trailPositions = getTrailPositions(trails.length, trailOrder)

    return trails.map((trail, index) => {
      const labelSeed = getLabelSeed(trail)

      return {
        label: trail,
        motion: getTrailMotion(index, labelSeed, trailPositions[index]),
        size: getTrailSize(labelSeed, index),
        tone: getTrailTone(labelSeed, index),
      }
    })
  }, [trails])

  return (
    <section className="thinking-home__trail">
      <ol className="thinking-home__orbit">
        {trailItems.map((trail) => (
          <li
            className={`thinking-home__orbit-tag thinking-home__orbit-tag--${trail.tone} thinking-home__orbit-tag--${trail.size} thinking-home__orbit-tag--layer-${trail.motion.layer}`}
            key={trail.label}
            style={{
              transform: trail.motion.transform,
            }}
          >
            <span
              className={`thinking-home__orbit-label thinking-home__orbit-label--float-${trail.motion.float}`}
              style={{
                animationDelay: trail.motion.delay,
                animationDuration: trail.motion.duration,
              }}
            >
              {trail.label}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

TrailCloud.displayName = 'TrailCloud'
