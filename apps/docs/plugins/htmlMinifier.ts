import type { RsbuildPlugin } from '@rsbuild/core'
import { minify, type Options } from 'html-minifier-terser'

export type HtmlMinifierOptions = {
  minifyOptions?: Options
}

export function pluginHtmlMinifier({
  minifyOptions,
}: HtmlMinifierOptions = {}): RsbuildPlugin {
  return {
    name: 'plugin-html-minifier',
    setup(api) {
      api.processAssets(
        {
          stage: 'analyse',
          environments: ['node'],
        },
        async ({ assets, compilation, compiler }) => {
          await Promise.all(
            Object.entries(assets)
              .filter(([assetName]) => assetName.endsWith('.html'))
              .map(async ([assetName, assetSource]) => {
                const html = assetSource.source().toString()
                const minifiedHtml = await minify(html, {
                  removeStyleLinkTypeAttributes: true,
                  removeScriptTypeAttributes: true,
                  removeRedundantAttributes: true,
                  removeEmptyAttributes: true,
                  conservativeCollapse: true,
                  collapseWhitespace: true,
                  keepClosingSlash: true,
                  removeComments: false,
                  minifyCSS: true,
                  minifyJS: true,
                  ...minifyOptions,
                })

                compilation.updateAsset(
                  assetName,
                  new compiler.webpack.sources.RawSource(minifiedHtml)
                )
              })
          )
        }
      )
    },
  }
}
