// Structural sharing for the polled project: wherever the new value deep-equals the old one, keep the old object, so
// unchanged slices keep their identity across polls and memoized views skip the work. Arrays of objects with an `id`
// are matched by id, so a cut or asset added at the front does not make every later item look new. (The idea is React
// Query's replaceEqualDeep.)

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype
const keyed = (list: unknown[]) => list.every((x) => plain(x) && typeof x.id === "string")

export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T
  if (Array.isArray(prev) && Array.isArray(next)) {
    const byId = keyed(prev) && keyed(next) ? new Map(prev.map((x) => [(x as { id: string }).id, x])) : undefined
    let same = prev.length === next.length
    const out = next.map((x, i) => {
      const old = byId ? byId.get((x as { id: string }).id) : prev[i]
      const s = share(old, x)
      if (s !== prev[i]) same = false
      return s
    })
    return (same ? prev : out) as T
  }
  if (plain(prev) && plain(next)) {
    const keys = Object.keys(next)
    let same = keys.length === Object.keys(prev).length
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      out[k] = share(prev[k], next[k])
      if (out[k] !== prev[k] || !(k in prev)) same = false
    }
    return (same ? prev : out) as T
  }
  return next
}
