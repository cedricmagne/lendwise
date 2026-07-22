import { Toaster } from 'sonner'

import { Footer } from '@/components/footer'
import { Navbar } from '@/components/navbar'
import {
  CurrencyProvider,
  WalletWatcherProvider,
  Web3Provider,
} from '@/contexts'

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <Web3Provider>
      <CurrencyProvider defaultCurrency="USD">
        <WalletWatcherProvider>
          <div className="flex h-screen flex-col overflow-hidden">
            <Navbar />
            <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
            <Footer />
          </div>
          <Toaster position="top-right" richColors />
        </WalletWatcherProvider>
      </CurrencyProvider>
    </Web3Provider>
  )
}
