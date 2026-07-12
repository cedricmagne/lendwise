import type { Metadata } from 'next'

import {
  Inter,
  JetBrains_Mono,
  Zalando_Sans_SemiExpanded,
} from 'next/font/google'

import { ThemeProvider } from '@/contexts'

import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500'],
  display: 'swap',
})

const zalando = Zalando_Sans_SemiExpanded({
  subsets: ['latin'],
  variable: '--font-zalando',
  display: 'swap',
  weight: '400',
  fallback: ['system-ui', 'sans-serif'],
  adjustFontFallback: false,
})

export const metadata: Metadata = {
  title: 'Yield Optimizer - DeFi Portfolio Optimization',
  description: 'Maximize yields and minimize costs across DeFi protocols',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} ${zalando.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
