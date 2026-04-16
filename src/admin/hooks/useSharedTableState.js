import { useMemo, useState } from 'react'

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // no-op for private mode/storage limitations
  }
}

export default function useSharedTableState({ storageKey, defaultPreset = 'default' }) {
  const chipsKey = `${storageKey}:chips`
  const presetKey = `${storageKey}:preset`
  const [savedFilterChips, setSavedFilterChips] = useState(() => readStorage(chipsKey, []))
  const [activePreset, setActivePreset] = useState(() => readStorage(presetKey, defaultPreset))

  const saveChip = (label, filters) => {
    const next = [{ id: `${Date.now()}`, label, filters }, ...savedFilterChips].slice(0, 8)
    setSavedFilterChips(next)
    writeStorage(chipsKey, next)
  }

  const removeChip = (id) => {
    const next = savedFilterChips.filter((item) => item.id !== id)
    setSavedFilterChips(next)
    writeStorage(chipsKey, next)
  }

  const selectedPreset = useMemo(() => activePreset, [activePreset])

  const changePreset = (preset) => {
    setActivePreset(preset)
    writeStorage(presetKey, preset)
  }

  return {
    savedFilterChips,
    saveChip,
    removeChip,
    activePreset: selectedPreset,
    setActivePreset: changePreset,
  }
}
