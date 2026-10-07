"use client"

// Where you are in the app lives in the URL, not in local storage: ?p=order-now&view=process&stage=voice#voice:cast.
// A refresh lands on the same place, and a pasted link shows someone exactly what you are looking at. Moving
// somewhere pushes a history entry, so back and forward work. Local storage keeps only per-viewer conveniences.

import { useCallback, useEffect, useSyncExternalStore } from "react"

export const getParam = (k: string) => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(k))

/** Change some params (null removes one). A new place drops the old #anchor unless `keepHash`. */
export function setParams(patch: Record<string, string | null>, { push = true, keepHash = false }: { push?: boolean; keepHash?: boolean } = {}) {
  const u = new URL(window.location.href)
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") u.searchParams.delete(k)
    else u.searchParams.set(k, v)
  }
  if (!keepHash) u.hash = ""
  if (u.href === window.location.href) return
  if (push) history.pushState(null, "", u)
  else history.replaceState(null, "", u)
  window.dispatchEvent(new Event("stitch:url"))
}

const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb)
  window.addEventListener("stitch:url", cb)
  return () => {
    window.removeEventListener("popstate", cb)
    window.removeEventListener("stitch:url", cb)
  }
}

/** One URL param as React state. */
export function useParam(k: string) {
  const v = useSyncExternalStore(subscribe, () => getParam(k), () => null)
  const set = useCallback((val: string | null, opts?: { push?: boolean }) => setParams({ [k]: val }, opts), [k])
  return [v, set] as const
}

/** Scroll to the #anchor once the element it names has rendered (the project loads after the page). */
export function useScrollToHash(ready: unknown) {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    let tries = 0
    const t = setInterval(() => {
      const el = document.getElementById(id)
      if (el || ++tries > 40) {
        clearInterval(t)
        el?.scrollIntoView({ block: "start" })
      }
    }, 100)
    return () => clearInterval(t)
  }, [ready])
}
