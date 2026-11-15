import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '骨架骨架 · 全栈铲子',
  description: '由全栈铲子插件生成的骨架，先零 key 跑通 mock，再接真引擎。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
