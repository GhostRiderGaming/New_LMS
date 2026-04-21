/**
 * useGameProgress — React hook for tracking XP, completed missions, and achievements.
 * Persisted in localStorage. Auto-awards XP on generation completions.
 */
import { useState, useEffect, useCallback } from 'react'

interface GameProgress {
  xp: number
  level: number
  missionsCompleted: number
  achievements: string[]
  streak: number
  lastActiveDate: string
}

const INITIAL_STATE: GameProgress = {
  xp: 0,
  level: 1,
  missionsCompleted: 0,
  achievements: [],
  streak: 0,
  lastActiveDate: '',
}

const XP_PER_LEVEL = 100

const ACHIEVEMENT_DEFS: Record<string, { name: string; icon: string; condition: (p: GameProgress) => boolean }> = {
  first_mission: { name: "First Steps", icon: "🌱", condition: (p) => p.missionsCompleted >= 1 },
  explorer: { name: "Explorer", icon: "🧭", condition: (p) => p.missionsCompleted >= 5 },
  scholar: { name: "Scholar", icon: "📚", condition: (p) => p.missionsCompleted >= 10 },
  master: { name: "Master", icon: "🏆", condition: (p) => p.missionsCompleted >= 25 },
  streak_3: { name: "On Fire", icon: "🔥", condition: (p) => p.streak >= 3 },
  level_5: { name: "Rising Star", icon: "⭐", condition: (p) => p.level >= 5 },
  level_10: { name: "Legendary", icon: "👑", condition: (p) => p.level >= 10 },
}

function loadProgress(): GameProgress {
  if (typeof window === 'undefined') return INITIAL_STATE
  try {
    const saved = localStorage.getItem('animeedu_progress')
    if (saved) return JSON.parse(saved)
  } catch {}
  return INITIAL_STATE
}

function saveProgress(progress: GameProgress) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('animeedu_progress', JSON.stringify(progress))
  } catch {}
}

export function useGameProgress() {
  const [progress, setProgress] = useState<GameProgress>(INITIAL_STATE)

  useEffect(() => {
    setProgress(loadProgress())
  }, [])

  const addXP = useCallback((amount: number) => {
    setProgress(prev => {
      const newXP = prev.xp + amount
      const newLevel = Math.floor(newXP / XP_PER_LEVEL) + 1
      
      // Check streak
      const today = new Date().toISOString().split('T')[0]
      let newStreak = prev.streak
      if (prev.lastActiveDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
        newStreak = prev.lastActiveDate === yesterday ? prev.streak + 1 : 1
      }
      
      const updated: GameProgress = {
        ...prev,
        xp: newXP,
        level: newLevel,
        streak: newStreak,
        lastActiveDate: today,
      }
      
      // Check achievements
      const newAchievements = [...prev.achievements]
      for (const [key, def] of Object.entries(ACHIEVEMENT_DEFS)) {
        if (!newAchievements.includes(key) && def.condition(updated)) {
          newAchievements.push(key)
        }
      }
      updated.achievements = newAchievements
      
      saveProgress(updated)
      return updated
    })
  }, [])

  const completeMission = useCallback((type: string) => {
    setProgress(prev => {
      const updated = {
        ...prev,
        missionsCompleted: prev.missionsCompleted + 1,
      }
      saveProgress(updated)
      return updated
    })
    // Award XP based on mission type
    const xpMap: Record<string, number> = {
      anime: 10,
      simulation: 20,
      model3d: 15,
      story: 30,
    }
    addXP(xpMap[type] ?? 10)
  }, [addXP])

  return { progress, addXP, completeMission }
}
