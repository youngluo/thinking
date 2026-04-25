import { readdirSync, statSync } from 'fs'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitepress'
import { size, map, get } from 'lodash-es'
import { globSync } from 'glob'

type SidebarItem =
  | { text: string; collapsed?: boolean; items?: ReturnType<typeof genSidebar> }
  | { text: string; link: string }

function genSidebar(baseDir: string) {
  const dir = baseDir.replace('docs/', '')
  return globSync(`${baseDir}/*.md`).map((f) => {
    const name = f.match(/\/([^/]+)\.md$/)?.[1] || ''
    return { text: name, link: `/${dir}/${name}` }
  })
}

function genNavItem(name: string, baseDir: string): SidebarItem {
  const path = `${baseDir}/${name}`
  const isDir = statSync(path).isDirectory()
  if (isDir) {
    return { text: name, collapsed: true, items: genSidebar(path) }
  }
  return {
    text: name.replace('.md', ''),
    link: `/${baseDir.split('/')[1]}/${name.replace('.md', '')}`,
  }
}

const writingsSidebar: SidebarItem[] = readdirSync('docs/writings').map(
  (name) => genNavItem(name, 'docs/writings')
)

const getFirstLink = (sidebar: SidebarItem[]) => {
  for (const item of sidebar) {
    if ('items' in item) return get(item.items, '[0].link')
    if ('link' in item) return item.link
  }
}

const experiencesSidebar: SidebarItem[] = [
  { text: '架构', items: ['如何理解前端架构'] },
  {
    text: '监控',
    items: ['日志采集', '性能指标采集', '性能异常监控', '页面崩溃监控'],
  },
  {
    text: '流处理',
    items: ['API 扫盲', 'AI 应用', '大文件处理', '实时音视频'],
  },
  { text: '数据请求' },
].map((item) => {
  if (size(item.items) > 0) {
    return {
      text: item.text,
      collapsed: true,
      items: map(item.items, (page) => ({
        link: `/experiences/${item.text}/${page}`,
        text: page,
      })),
    }
  }
  return { text: item.text, link: `/experiences/${item.text}` }
})

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
      { text: '项目经验', link: getFirstLink(experiencesSidebar)! },
      { text: '手写题', link: getFirstLink(writingsSidebar)! },
    ],
    sidebar: {
      '/experiences/': experiencesSidebar,
      '/writings/': writingsSidebar,
    },
  },
})
