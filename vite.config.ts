import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 相対パスにしておくと GitHub Pages のサブパス (/リポジトリ名/) でも動く
export default defineConfig({
  base: './',
  plugins: [react()],
})
