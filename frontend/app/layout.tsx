import './globals.css'
import { Inter } from 'next/font/google'
import type { Metadata } from 'next'
import Sidebar from '@/components/layout/Sidebar'
import BellaOverlay from '@/components/bella/BellaOverlay'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AnimeEdu — Educational Anime Generator',
  description: 'Generate educational anime, simulations, 3D models, and interactive stories powered by AI.',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-bg-primary`} suppressHydrationWarning>
        <Sidebar />
        <main className="ml-16 md:ml-56 min-h-screen">
          {children}
        </main>
        <BellaOverlay />
      </body>
    </html>
  )
}
