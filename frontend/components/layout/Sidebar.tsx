'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/', label: 'Home', icon: '⚡' },
  { href: '/anime', label: 'Anime', icon: '🎨' },
  { href: '/simulation', label: 'Simulate', icon: '🔬' },
  { href: '/model3d', label: '3D Model', icon: '🧊' },
  { href: '/story', label: 'Story', icon: '📖' },
  { href: '/gallery', label: 'Gallery', icon: '🗂️' },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="fixed left-0 top-0 h-full w-16 md:w-56 bg-bg-secondary border-r border-border flex flex-col z-40">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-anime flex items-center justify-center text-sm font-bold shrink-0">
            A
          </div>
          <span className="hidden md:block font-bold text-sm gradient-text">AnimeEdu</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 group ${
                active
                  ? 'bg-accent-purple text-white shadow-glow-purple'
                  : 'text-slate-400 hover:bg-bg-elevated hover:text-white'
              }`}
            >
              <span className="text-base shrink-0">{item.icon}</span>
              <span className="hidden md:block font-medium">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <div className="hidden md:block text-xs text-slate-600 text-center">
          Powered by Groq + Fal.ai
        </div>
      </div>
    </aside>
  )
}
