import { Footer } from '@/components/landing/Footer'
import { NavBar } from '@/components/landing/NavBar'

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-background text-foreground selection:bg-primary selection:text-primary-foreground min-h-screen font-sans antialiased [&_a]:no-underline">
      <NavBar />
      <main className="wrap pt-35 pb-27.5">
        <div className="mx-auto max-w-180">{children}</div>
      </main>
      <Footer />
    </div>
  )
}
