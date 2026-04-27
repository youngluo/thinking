import config from '@vainjs/eslint-config'

/** @type {import("eslint").Linter.Config} */
export default {
  ...config,
  ignores: [
    'node_modules',
    'dist',
    '**/*.test.ts',
    '**/*.test.js',
    'apps/docs/.vitepress/dist',
    'apps/docs/.vitepress/cache',
    '.turbo',
    'packages/*/dist',
    'packages/*/node_modules',
  ],
}
