import { useLocation } from 'react-router-dom'

/** Exposes the router's address to `currentLocation` in `render.tsx`. */
export function LocationProbe() {
  const { pathname, search } = useLocation()
  return <span hidden data-testid="location">{`${pathname}${search}`}</span>
}
