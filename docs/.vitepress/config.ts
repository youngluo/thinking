import { readdirSync } from 'fs'
import { defineConfig } from 'vitepress'
import { globSync } from 'glob'
import tailwindcss from '@tailwindcss/vite'

const writingsSidebar = readdirSync('docs/writings').map((name) => ({
  text: name,
  collapsed: true,
  items: genSidebar(`docs/writings/${name}`),
}))

const experiencesSidebar = readdirSync('docs/experiences').map((name) => ({
  text: name,
  collapsed: true,
  items: genSidebar(`docs/experiences/${name}`),
}))

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/thinking/' : '/',
  title: 'Thinking',
  vite: {
    plugins: [tailwindcss()],
  },
  description: '前端经验总结',
  srcDir: '.',
  themeConfig: {
    nav: [
      {
        text: '项目经验',
        link: experiencesSidebar[0]?.items[0]?.link,
      },
      { text: '手写题', link: writingsSidebar[0]?.items[0]?.link },
    ],
    sidebar: {
      '/experiences/': experiencesSidebar,
      '/writings/': writingsSidebar,
    },
  },
})

function genSidebar(baseDir: string) {
  const dir = baseDir.replace('docs/', '')
  return globSync(`${baseDir}/*.md`).map((f) => {
    const name = f.match(/\/([^/]+)\.md$/)?.[1] || ''
    return { text: name, link: `/${dir}/${name}` }
  })
}
