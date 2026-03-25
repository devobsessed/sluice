import { useEffect, useRef } from 'react'

export interface UseInfiniteScrollOptions {
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  /** Distance from the bottom of the viewport at which to pre-fetch. Default: '200px' */
  rootMargin?: string
}

export interface UseInfiniteScrollResult {
  sentinelRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Attach sentinelRef to a div at the bottom of a scrollable list.
 * The hook fires onLoadMore when the sentinel enters the viewport
 * (offset by rootMargin) as long as hasMore is true and isLoading is false.
 */
export function useInfiniteScroll({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = '200px',
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Keep a stable ref to the callback so the effect doesn't recreate the
  // observer on every render just because onLoadMore is a new function reference.
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && hasMore && !isLoading) {
          onLoadMoreRef.current()
        }
      },
      { rootMargin }
    )

    const sentinel = sentinelRef.current
    if (sentinel) {
      observer.observe(sentinel)
    }

    return () => {
      observer.disconnect()
    }
  }, [hasMore, isLoading, rootMargin])

  return { sentinelRef }
}
