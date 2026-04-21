# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test           # Run all tests (Jest)
npm run commit     # Interactive commit via commitizen (cz-conventional-changelog)
```

- Single test: `npx jest src/__tests__/<filename>`
- Lint: `eslint --fix` (configured via husky pre-commit hook)

## Architecture

TypeScript utilities library with the following structure:

```
src/
├── algorithms/      # Algorithm implementations (sorting, string matching, etc.)
├── dataStructures/ # Data structure implementations (LRU cache, linked hash map)
├── designPatterns/ # Design patterns (event emitter, observer)
├── functional/     # Functional utilities (compose, curry, flatDeep, reduce)
├── utils/          # General utilities (debounce, deepClone, query, retry, etc.)
└── __tests__/      # Test files co-located in single directory
```

## Tech Stack

- **TypeScript**: Strict mode, ES5 target, CommonJS modules
- **Testing**: Jest with ts-jest preset
- **Linting**: ESLint + TypeScript plugin, runs via husky pre-commit
- **Commits**: commitlint + commitizen with conventional-changelog format
