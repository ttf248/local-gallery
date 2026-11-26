import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

import { existsSync, readdirSync } from 'node:fs'

const featureRoot = new URL('./src/features/', import.meta.url)
const domains = existsSync(featureRoot)
  ? readdirSync(featureRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  : []

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.smoke/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // 依赖数组写错是 React 里最难查的一类 bug（闭包拿到旧值、effect
      // 不重跑、监听重复注册），默认只当警告就等于不管。
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        regex: '(?:^|/)(?:hooks|store|api|features|shell|routes|components|utils)/',
        message: '界面原语只依赖展示层。'
      }] }]
    }
  },
  ...domains.map(domain => ({
    files: [`src/features/${domain}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', { patterns: domains.filter(other => other !== domain).map(other => ({
        regex: `(?:^|/)${other}/(?!index(?:\\\\.tsx?)?$).+`,
        message: '跨领域组件从公开入口导入。'
      })) }]
    }
  }))
]
