'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

export interface PersonaChannel {
  channelName: string
  transcriptCount: number
  personaId: number | null
  personaCreatedAt: string | null
  personaName: string | null
  expertiseTopics: string[] | null
}

interface PersonaStatusContextValue {
  channels: PersonaChannel[]
  threshold: number
  isLoading: boolean
  /** Update a single channel in the shared state (e.g., after persona creation) */
  updateChannel: (channelName: string, updates: Partial<PersonaChannel>) => void
  refetch: () => Promise<void>
}

const PersonaStatusContext = createContext<PersonaStatusContextValue | undefined>(undefined)

export function PersonaStatusProvider({ children }: { children: React.ReactNode }) {
  const [channels, setChannels] = useState<PersonaChannel[]>([])
  const [threshold, setThreshold] = useState(5)
  const [isLoading, setIsLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/personas/status')
      if (!response.ok) return
      const data = await response.json()
      setChannels(data.channels || [])
      setThreshold(data.threshold ?? 5)
    } catch {
      // Silently fail - persona status is non-critical
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Deferred fetch on mount - 1.5s delay matches the earlier of the two timers
  // (ChatHubDrawer used 1.5s, PersonaStatus used 2s). Using the shorter delay
  // ensures both consumers get data as soon as the earlier one would have.
  useEffect(() => {
    const timer = setTimeout(fetchStatus, 1500)
    return () => clearTimeout(timer)
  }, [fetchStatus])

  const updateChannel = useCallback((channelName: string, updates: Partial<PersonaChannel>) => {
    setChannels(prev =>
      prev.map(c =>
        c.channelName === channelName ? { ...c, ...updates } : c
      )
    )
  }, [])

  return (
    <PersonaStatusContext.Provider value={{ channels, threshold, isLoading, updateChannel, refetch: fetchStatus }}>
      {children}
    </PersonaStatusContext.Provider>
  )
}

export function usePersonaStatus() {
  const context = useContext(PersonaStatusContext)
  if (context === undefined) {
    throw new Error('usePersonaStatus must be used within a PersonaStatusProvider')
  }
  return context
}
