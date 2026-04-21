'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useGameProgress } from '@/lib/useGameProgress'

const navItems = [
  { href: '/', label: 'Home', icon: '⚡', desc: 'Mission Control' },
  { href: '/anime', label: 'Anime', icon: '🎨', desc: 'Scene Forge' },
  { href: '/simulation', label: 'Simulate', icon: '🔬', desc: 'Lab Engine' },
  { href: '/model3d', label: '3D Model', icon: '🧊', desc: 'Holodeck' },
  { href: '/story', label: 'Story', icon: '📖', desc: 'Chronicle' },
  { href: '/gallery', label: 'Gallery', icon: '🗂️', desc: 'Archive' },
]

export default function GameHUD() {
  const pathname = usePathname()
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { progress } = useGameProgress()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Close mobile menu on navigation
  useEffect(() => { setMobileMenuOpen(false) }, [pathname])

  const xpInLevel = mounted ? progress.xp % 100 : 0
  const level = mounted ? progress.level : 1

  return (
    <>
      {/* Top HUD Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 glass" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 sm:gap-3 group shrink-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-game flex items-center justify-center text-xs sm:text-sm font-black text-white shadow-glow-purple transition-all group-hover:scale-110">
              A
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-sm gradient-text">AnimeEdu</span>
              <span className="text-[10px] text-slate-500 block -mt-0.5">Learning Universe</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onMouseEnter={() => setHoveredItem(item.href)}
                  onMouseLeave={() => setHoveredItem(null)}
                  className={`relative flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-300 ${
                    active
                      ? 'bg-accent-purple/20 text-white border border-accent-purple/40 shadow-glow-purple'
                      : 'text-slate-400 hover:text-white hover:bg-bg-elevated/50'
                  }`}
                >
                  <span className="text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                  
                  {/* Active indicator dot */}
                  {active && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent-purple shadow-glow-purple" />
                  )}
                  
                  {/* Tooltip */}
                  {hoveredItem === item.href && !active && (
                    <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-lg bg-bg-elevated border border-border text-[10px] text-slate-300 whitespace-nowrap animate-fadeInUp z-50">
                      {item.desc}
                    </div>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Right side: Stats + Mobile burger */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* XP Bar */}
            {mounted && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-bg-card/80 border border-border backdrop-blur-sm">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-accent-gold">LV{level}</span>
                </div>
                <div className="w-16 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-accent-purple to-accent-cyan transition-all duration-500"
                    style={{ width: `${xpInLevel}%` }}
                  />
                </div>
                <span className="text-[9px] text-slate-500">{progress.xp}XP</span>
              </div>
            )}

            {/* Missions counter */}
            {mounted && progress.missionsCompleted > 0 && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-card/80 border border-border">
                <span className="text-[10px]">🏆</span>
                <span className="text-[10px] text-accent-gold font-medium">{progress.missionsCompleted}</span>
              </div>
            )}

            {/* Streak */}
            {mounted && progress.streak > 0 && (
              <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-card/80 border border-orange-500/20">
                <span className="text-[10px]">🔥</span>
                <span className="text-[10px] text-orange-400 font-medium">{progress.streak}d</span>
              </div>
            )}

            {/* System Status */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-card border border-border">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-slate-400">Online</span>
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden flex flex-col gap-1 p-2 rounded-lg hover:bg-bg-elevated/50 transition-colors"
              aria-label="Toggle menu"
            >
              <span className={`w-5 h-0.5 bg-slate-400 rounded-full transition-all ${mobileMenuOpen ? 'rotate-45 translate-y-1.5' : ''}`} />
              <span className={`w-5 h-0.5 bg-slate-400 rounded-full transition-all ${mobileMenuOpen ? 'opacity-0' : ''}`} />
              <span className={`w-5 h-0.5 bg-slate-400 rounded-full transition-all ${mobileMenuOpen ? '-rotate-45 -translate-y-1.5' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute top-14 right-0 w-64 bg-bg-card/95 backdrop-blur-xl border-l border-b border-border rounded-bl-2xl shadow-2xl animate-slideInRight">
            <nav className="p-4 space-y-1">
              {navItems.map((item) => {
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                      active
                        ? 'bg-accent-purple/20 text-white border border-accent-purple/30'
                        : 'text-slate-400 hover:text-white hover:bg-bg-elevated/50'
                    }`}
                  >
                    <span className="text-lg">{item.icon}</span>
                    <div>
                      <div>{item.label}</div>
                      <div className="text-[10px] text-slate-500">{item.desc}</div>
                    </div>
                  </Link>
                )
              })}
            </nav>
            
            {/* Mobile XP display */}
            {mounted && (
              <div className="px-4 pb-4 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">Level {level}</span>
                  <span className="text-xs text-accent-gold">{progress.xp} XP</span>
                </div>
                <div className="w-full h-2 rounded-full bg-bg-elevated overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-accent-purple to-accent-cyan transition-all"
                    style={{ width: `${xpInLevel}%` }}
                  />
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <span className="text-xs text-slate-500">🏆 {progress.missionsCompleted} missions</span>
                  {progress.streak > 0 && <span className="text-xs text-orange-400">🔥 {progress.streak}d streak</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Spacer for fixed header */}
      <div className="h-14" />
    </>
  )
}
