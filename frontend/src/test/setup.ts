import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does no layout, so it has no such method; the searchable select calls it.
Element.prototype.scrollIntoView = () => undefined

afterEach(() => cleanup())
