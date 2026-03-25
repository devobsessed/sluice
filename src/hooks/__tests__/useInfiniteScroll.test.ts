import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInfiniteScroll } from '../useInfiniteScroll'

// IntersectionObserver is not available in jsdom — mock it per test so we can
// control exactly which calls fire and when.
let observerCallback: IntersectionObserverCallback | null = null
let observerOptions: IntersectionObserverInit | null = null

const mockObserve = vi.fn()
const mockUnobserve = vi.fn()
const mockDisconnect = vi.fn()

class MockIntersectionObserver {
  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    observerCallback = callback
    observerOptions = options ?? null
  }
  observe = mockObserve
  unobserve = mockUnobserve
  disconnect = mockDisconnect
}

beforeEach(() => {
  vi.clearAllMocks()
  observerCallback = null
  observerOptions = null
  global.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Helper: simulate the sentinel entering the viewport */
function triggerIntersect(isIntersecting: boolean) {
  if (!observerCallback) throw new Error('Observer not initialised')
  const entry = { isIntersecting } as IntersectionObserverEntry
  observerCallback([entry], {} as IntersectionObserver)
}

describe('useInfiniteScroll', () => {
  it('calls onLoadMore when sentinel is intersecting, hasMore=true, isLoading=false', () => {
    const onLoadMore = vi.fn()

    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore })
    )

    // sentinelRef must be a ref object
    expect(result.current.sentinelRef).toBeDefined()
    expect(typeof result.current.sentinelRef).toBe('object')

    act(() => {
      triggerIntersect(true)
    })

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onLoadMore when hasMore=false', () => {
    const onLoadMore = vi.fn()

    renderHook(() =>
      useInfiniteScroll({ hasMore: false, isLoading: false, onLoadMore })
    )

    act(() => {
      triggerIntersect(true)
    })

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does NOT call onLoadMore when isLoading=true', () => {
    const onLoadMore = vi.fn()

    renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: true, onLoadMore })
    )

    act(() => {
      triggerIntersect(true)
    })

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does NOT call onLoadMore when sentinel is not intersecting', () => {
    const onLoadMore = vi.fn()

    renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore })
    )

    act(() => {
      triggerIntersect(false)
    })

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('uses the default rootMargin of 200px', () => {
    const onLoadMore = vi.fn()

    renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore })
    )

    expect(observerOptions?.rootMargin).toBe('200px')
  })

  it('uses a custom rootMargin when provided', () => {
    const onLoadMore = vi.fn()

    renderHook(() =>
      useInfiniteScroll({
        hasMore: true,
        isLoading: false,
        onLoadMore,
        rootMargin: '100px',
      })
    )

    expect(observerOptions?.rootMargin).toBe('100px')
  })

  it('disconnects the observer on unmount', () => {
    const onLoadMore = vi.fn()

    const { unmount } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore })
    )

    unmount()

    expect(mockDisconnect).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onLoadMore when hasMore=false even if isLoading=true', () => {
    const onLoadMore = vi.fn()

    renderHook(() =>
      useInfiniteScroll({ hasMore: false, isLoading: true, onLoadMore })
    )

    act(() => {
      triggerIntersect(true)
    })

    expect(onLoadMore).not.toHaveBeenCalled()
  })
})
