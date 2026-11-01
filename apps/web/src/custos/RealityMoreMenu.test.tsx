import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {Router} from 'react-router-dom'
import {createMemoryHistory} from 'history'
import {afterEach, expect, it, vi} from 'vitest'
import RealityMoreMenu from './RealityMoreMenu'

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
afterEach(() => {act(() => root?.unmount());container?.remove()})
async function setup() {
  container = document.createElement('div');document.body.appendChild(container);root = createRoot(container)
  const history = createMemoryHistory({initialEntries: ['/reality/account']}), warm = vi.fn()
  await act(async () => root.render(<Router history={history}><RealityMoreMenu warmFaucet={warm}/></Router>))
  return {history, warm, trigger: container.querySelector('button')!}
}
it('hides the faucet until opened, then routes and closes', async () => {
  const {history, warm, trigger} = await setup()
  expect(document.querySelector('[role=menu]')).toBeNull()
  await act(async () => trigger.click())
  const link = document.querySelector<HTMLAnchorElement>('[role=menuitem]')!
  expect(link.textContent).toBe('Faucet')
  expect(document.activeElement).toBe(link)
  expect(warm).toHaveBeenCalled()
  await act(async () => link.click())
  expect(history.location.pathname).toBe('/reality/faucet')
  expect(document.querySelector('[role=menu]')).toBeNull()
  expect(trigger.classList.contains('active')).toBe(true)
})
it('opens by arrow key and closes with Escape, restoring trigger focus', async () => {
  const {trigger} = await setup()
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
})
it('closes on outside pointer and navigation scrolling', async () => {
  const {trigger} = await setup()
  await act(async () => trigger.click())
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', {bubbles: true})))
  expect(document.querySelector('[role=menu]')).toBeNull()
  await act(async () => trigger.click())
  await act(async () => window.dispatchEvent(new Event('scroll')))
  expect(document.querySelector('[role=menu]')).toBeNull()
})
