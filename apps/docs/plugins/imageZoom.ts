import { dirname, join } from 'node:path'
import type { RspressPlugin } from '@rspress/core'

export type ImageZoomOptions = {
  selector?: string
  minZoom?: number
  maxZoom?: number
}

const __dirname = dirname(decodeURIComponent(new URL(import.meta.url).pathname))

export function pluginImageZoom(options: ImageZoomOptions = {}): RspressPlugin {
  return {
    name: 'plugin-image-zoom',
    globalUIComponents: [
      [
        join(__dirname, './imageZoom/ImageZoom.tsx'),
        {
          selector: '.rspress-doc img, .rspress-doc svg',
          minZoom: 0.5,
          maxZoom: 8,
          ...options,
        },
      ],
    ],
  }
}
