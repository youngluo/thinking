import { useLocation } from '@rspress/core/runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import createPanZoom from 'panzoom'
import type { PanZoom } from 'panzoom'
import type { MouseEvent } from 'react'
import './ImageZoom.css'

type ImageZoomProps = {
  selector?: string
  minZoom?: number
  maxZoom?: number
}

type ZoomableElement = HTMLImageElement | SVGSVGElement

const MAX_INITIAL_SCALE = 1.25

function isZoomableElement(element: Element): element is ZoomableElement {
  return element instanceof HTMLImageElement || element instanceof SVGSVGElement
}

function prepareClone(element: ZoomableElement) {
  const clone = element.cloneNode(true) as ZoomableElement

  clone.classList.add('image-zoom__content')
  clone.removeAttribute('id')

  if (clone instanceof HTMLImageElement) {
    clone.draggable = false
    clone.decoding = 'async'
  }

  return clone
}

function getFittedSize(element: ZoomableElement, container: HTMLElement) {
  const sourceRect = element.getBoundingClientRect()
  const sourceWidth = sourceRect.width || 1
  const sourceHeight = sourceRect.height || 1
  const scale = Math.min(
    container.clientWidth / sourceWidth,
    container.clientHeight / sourceHeight,
    MAX_INITIAL_SCALE
  )

  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  }
}

function getCenteredPosition(
  size: { width: number; height: number },
  container: HTMLElement
) {
  return {
    x: (container.clientWidth - size.width) / 2,
    y: (container.clientHeight - size.height) / 2,
  }
}

function isEventInsideContent(event: Event, content: ZoomableElement) {
  return event.target instanceof Node && content.contains(event.target)
}

export default function ImageZoom(props: ImageZoomProps) {
  const {
    selector = '.rspress-doc img, .rspress-doc svg',
    minZoom = 0.5,
    maxZoom = 8,
  } = props
  const { pathname } = useLocation()
  const [activeElement, setActiveElement] = useState<ZoomableElement | null>(
    null
  )
  const [isClosing, setIsClosing] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const panZoomRef = useRef<PanZoom | null>(null)

  const close = useCallback(() => {
    setIsClosing(true)
  }, [])

  const finishClose = useCallback(() => {
    setActiveElement(null)
    setIsClosing(false)
  }, [])

  const onViewportClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        close()
      }
    },
    [close]
  )

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll(selector)).filter(
      isZoomableElement
    )
    const cleanups = elements.map((element) => {
      const onClick = (event: Event) => {
        event.preventDefault()
        setIsClosing(false)
        setActiveElement(element)
      }

      element.classList.add('image-zoom__target')
      element.addEventListener('click', onClick)

      return () => {
        element.classList.remove('image-zoom__target')
        element.removeEventListener('click', onClick)
      }
    })

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [pathname, selector])

  useEffect(() => {
    if (!activeElement) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [activeElement, close])

  useEffect(() => {
    if (!activeElement) {
      return
    }

    const { overflow, paddingRight } = document.body.style
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth

    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
    }
  }, [activeElement])

  useEffect(() => {
    const viewport = viewportRef.current

    if (!activeElement || !viewport) {
      return
    }

    const clone = prepareClone(activeElement)
    const size = getFittedSize(activeElement, viewport)
    const position = getCenteredPosition(size, viewport)
    const scene = document.createElement('div')

    scene.className = 'image-zoom__scene'
    scene.style.width = `${size.width}px`
    scene.style.height = `${size.height}px`
    scene.append(clone)
    viewport.replaceChildren(scene)

    const onDoubleClick = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    scene.addEventListener('dblclick', onDoubleClick, { capture: true })

    const panZoom = createPanZoom(scene, {
      beforeMouseDown: (event) => !isEventInsideContent(event, clone),
      beforeWheel: (event) => !isEventInsideContent(event, clone),
      bounds: true,
      boundsPadding: 0.2,
      minZoom,
      maxZoom,
      onTouch: (event) => isEventInsideContent(event, clone),
      smoothScroll: false,
    })

    panZoomRef.current = panZoom
    panZoom.moveTo(position.x, position.y)

    return () => {
      scene.removeEventListener('dblclick', onDoubleClick, { capture: true })
      panZoom.dispose()
      panZoomRef.current = null
      viewport.replaceChildren()
    }
  }, [activeElement, maxZoom, minZoom])

  useEffect(() => {
    close()
  }, [close, pathname])

  if (!activeElement) {
    return null
  }

  return (
    <div
      className={`image-zoom${isClosing ? ' image-zoom--closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onAnimationEnd={(event) => {
        if (isClosing && event.currentTarget === event.target) {
          finishClose()
        }
      }}
    >
      <button
        className="image-zoom__close"
        type="button"
        aria-label="关闭"
        onClick={close}
      >
        ×
      </button>
      <div
        ref={viewportRef}
        className="image-zoom__viewport"
        onClick={onViewportClick}
      />
    </div>
  )
}
