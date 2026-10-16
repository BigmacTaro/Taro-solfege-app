// 配布物に含まれるオープンソースソフトウェア(本番用の依存パッケージ)のライセンス表記ページを作る。
// `npm run build` の前に自動で実行され、public/licenses.html を出力する。
// 依存パッケージを更新しても、表記が古くならないよう、node_modules から読み取る。
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** requirer のディレクトリから上へ node_modules をたどって、パッケージのディレクトリを探す */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// 本番用の依存だけを、再帰的にたどる(開発用の依存は、配布物に含まれない)
const packages = new Map() // "name@version" -> info
function visit(name, fromDir) {
  const dir = resolvePackageDir(name, fromDir)
  if (!dir) throw new Error(`パッケージが見つかりません: ${name}(${fromDir} から)`)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const key = `${pkg.name}@${pkg.version}`
  if (packages.has(key)) return
  const licenseFiles = readdirSync(dir)
    .filter((f) => /^(licen[sc]e|copying|notice|copyrightnotice)(\.[a-z]+)?$/i.test(f))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8').trim() }))
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  packages.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? '(記載なし)'),
    author: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name,
    homepage: pkg.homepage,
    repo: repo?.replace(/^git\+/, '').replace(/\.git$/, ''),
    licenseFiles,
  })
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir)
}
for (const dep of Object.keys(rootPkg.dependencies ?? {})) visit(dep, root)

const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
for (const p of list) {
  if (p.licenseFiles.length === 0) console.warn(`警告: ${p.name} にライセンスファイルがありません`)
}

// ---- 書体(VexFlow に同梱され、配布物に埋め込まれる) ----------------------------------------
// 書体ファイルに内蔵されたメタデータ(name テーブル)の記載をそのまま写している。
const fonts = [
  {
    name: 'Bravura',
    use: '楽譜の記号(音符・休符・音部記号・拍子記号など)',
    copyright: 'Copyright © 2021, Steinberg Media Technologies GmbH (http://www.steinberg.net/), with Reserved Font Name "Bravura".',
    version: 'Version 1.392',
  },
  {
    name: 'Academico(Regular)',
    use: '楽譜の小節番号などの文字',
    copyright: 'Copyright © 2022, Steinberg Media Technologies GmbH (http://www.steinberg.net/), with Reserved Font Name "Academico".',
    version: 'Version 0.902',
  },
  {
    name: 'Academico(Bold)',
    use: '楽譜の太字の文字',
    copyright: 'Copyright © 2020, Steinberg Media Technologies GmbH (http://www.steinberg.net/), with Reserved Font Name "Academico".',
    version: 'Version 0.902',
  },
]
const oflText = readFileSync(join(root, 'scripts', 'OFL-1.1.txt'), 'utf8').trim()
const ownLicense = readFileSync(join(root, 'LICENSE'), 'utf8').trim()

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const rows = list
  .map(
    (p) =>
      `<tr><td><a href="#pkg-${esc(p.name)}-${esc(p.version)}">${esc(p.name)}</a></td><td>${esc(p.version)}</td><td>${esc(p.license)}</td><td>${esc(p.author ?? '')}</td></tr>`,
  )
  .join('\n')

const details = list
  .map((p) => {
    const links = [p.homepage, p.repo].filter(Boolean).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join(' / ')
    const texts = p.licenseFiles.length
      ? p.licenseFiles.map((f) => `<h4>${esc(f.file)}</h4><pre>${esc(f.text)}</pre>`).join('\n')
      : '<p class="muted">(パッケージにライセンスファイルが含まれていません。ライセンス: ' + esc(p.license) + ')</p>'
    return `<section id="pkg-${esc(p.name)}-${esc(p.version)}">
<h3>${esc(p.name)} <span class="muted">${esc(p.version)}</span></h3>
<p>ライセンス: <b>${esc(p.license)}</b>${p.author ? ` / 作者: ${esc(p.author)}` : ''}</p>
${links ? `<p class="muted small">${links}</p>` : ''}
<details><summary>ライセンス全文</summary>
${texts}
</details>
</section>`
  })
  .join('\n')

const fontRows = fonts
  .map(
    (f) =>
      `<tr><td>${esc(f.name)}</td><td>${esc(f.version)}</td><td>${esc(f.use)}</td><td>${esc(f.copyright)}</td></tr>`,
  )
  .join('\n')

const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ソルフェージュ自習 - オープンソースのライセンス表記</title>
    <style>
      :root { color-scheme: light dark; --bg:#fff; --fg:#1c1c1e; --muted:#6c6c70; --panel:#f4f4f6; --line:rgba(128,128,128,.35); --accent:#0a6cff; }
      @media (prefers-color-scheme: dark) { :root { --bg:#000; --fg:#f2f2f7; --muted:#8e8e93; --panel:#1c1c1e; --accent:#3b8bff; } }
      body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui,-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif; line-height:1.65; }
      main { max-width: 860px; margin: 0 auto; padding: 16px 16px 64px; }
      h1 { font-size:1.4rem; margin: 8px 0; }
      h2 { font-size:1.15rem; margin: 28px 0 8px; padding-top: 8px; border-top: 2px solid var(--line); }
      h3 { font-size:1rem; margin: 18px 0 2px; }
      h4 { font-size:.85rem; margin: 10px 0 2px; color: var(--muted); }
      table { width:100%; border-collapse: collapse; font-size:.88rem; margin: 8px 0; }
      th,td { border:1px solid var(--line); padding:5px 8px; text-align:left; vertical-align:top; word-break: break-word; }
      th { background: var(--panel); white-space: nowrap; }
      pre { white-space: pre-wrap; word-break: break-word; background: var(--panel); padding: 10px; border-radius: 8px; font-size:.78rem; line-height:1.45; }
      details { margin: 6px 0; } summary { cursor:pointer; }
      .muted { color: var(--muted); } .small { font-size:.85rem; }
      .note { background: var(--panel); border-left: 4px solid var(--accent); padding: 8px 12px; border-radius: 6px; margin: 12px 0; }
      a { color: var(--accent); }
    </style>
  </head>
  <body>
    <main>
      <a href="./spec.html">← 仕様と使い方に戻る</a>
      <h1>オープンソースのライセンス表記</h1>
      <p>このアプリは、次のオープンソースのソフトウェアと書体を使っています。それぞれの作者・権利者に感謝します。ライセンスの全文は、下にまとめています。</p>
      <p class="muted small">このページは、配布物に含まれるソフトウェアから、ビルドのたびに自動で作られます。</p>
      <div class="note">本アプリ自体は <b>MIT ライセンス</b>です(下の「本アプリのライセンス」)。ただし、このページに載せたソフトウェアと書体は、それぞれのライセンスに従います。</div>

      <h2>本アプリのライセンス</h2>
      <pre>${esc(ownLicense)}</pre>

      <h2>1. ソフトウェア</h2>
      <table>
        <tr><th>名前</th><th>バージョン</th><th>ライセンス</th><th>作者</th></tr>
        ${rows}
      </table>

      <h2>2. 書体</h2>
      <p>楽譜の描画に使うVexFlowは、次の書体を内蔵しています。いずれも <b>SIL Open Font License, Version 1.1</b> のもとで配布されています。書体は、改変せずに、そのまま同梱しています。</p>
      <table>
        <tr><th>書体</th><th>版</th><th>用途</th><th>著作権表示(書体に内蔵された記載)</th></tr>
        ${fontRows}
      </table>
      <details>
        <summary>SIL Open Font License, Version 1.1 全文</summary>
        <p class="small">This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: <a href="https://openfontlicense.org" target="_blank" rel="noopener">https://openfontlicense.org</a></p>
        <pre>${esc(oflText)}</pre>
      </details>

      <h2>3. ライセンス全文(ソフトウェア)</h2>
      ${details}

      <p><a href="./spec.html">← 仕様と使い方に戻る</a></p>
    </main>
  </body>
</html>
`

writeFileSync(join(root, 'public', 'licenses.html'), html)
console.log(`ライセンス表記を作成しました: ${list.length} パッケージ + ${fonts.length} 書体 → public/licenses.html`)
