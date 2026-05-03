import { describe, expect, it, vi, beforeEach } from 'vitest'
import { clearPublicRouteChunkReloadGuard, loadPublicRouteChunk } from './lazyRouteLoader'

describe('lazyRouteLoader', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('reloads once on chunk load failure', async () => {
    const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const importer = vi.fn().mockRejectedValue(new Error('Failed to fetch dynamically imported module'))

    await loadPublicRouteChunk(importer, { route: '/help' })

    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('throws after retry has already been attempted', async () => {
    sessionStorage.setItem('hireflow_chunk_reload_attempted:test:/help', '1')
    const importer = vi.fn().mockRejectedValue(new Error('Failed to fetch dynamically imported module'))

    await expect(loadPublicRouteChunk(importer, { route: '/help' })).rejects.toThrow('Failed to fetch dynamically imported module')
  })

  it('clears reload guard', () => {
    sessionStorage.setItem('hireflow_chunk_reload_attempted:test:/help', '1')
    clearPublicRouteChunkReloadGuard('/help')
    expect(sessionStorage.getItem('hireflow_chunk_reload_attempted:test:/help')).toBeNull()
  })
})
