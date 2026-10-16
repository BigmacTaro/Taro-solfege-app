// 自動テスト。src の純粋なロジック(楽譜の生成・判定)をコンパイルして、Node の組み込みテストランナーで実行する。
//   npm test
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.test-build')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// ブラウザに依存しない部分だけを、CommonJS にコンパイルする(プロジェクトは ESM だが、テストの読み込み用)
const tsc = spawnSync(
  'npx',
  [
    'tsc',
    '--ignoreConfig',
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2022',
    '--skipLibCheck',
    'src/music/score.ts',
    'src/music/generator.ts',
    'src/eval/evaluate.ts',
  ],
  { cwd: root, stdio: 'inherit' },
)
if (tsc.status !== 0) process.exit(tsc.status ?? 1)
writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }))

const test = spawnSync(process.execPath, ['--test', 'tests/*.test.mjs'], { cwd: root, stdio: 'inherit' })
process.exit(test.status ?? 1)
