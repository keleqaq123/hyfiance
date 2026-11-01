import React, {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Link, useLocation} from 'react-router-dom'
import {Droplets, MoreHorizontal} from 'lucide-react'

export default function RealityMoreMenu({warmFaucet}: {warmFaucet: () => void}) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({top: 0, left: 0})
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const item = useRef<HTMLAnchorElement>(null)
  const active = location.pathname.includes('/faucet')
  useEffect(() => setOpen(false), [location.pathname, location.search, location.hash])
  useLayoutEffect(() => {
    if (!open) return
    const rect = trigger.current!.getBoundingClientRect()
    setPosition({top: rect.bottom + 8, left: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198))})
    item.current?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false)
    }
    const close = () => setOpen(false)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.preventDefault();setOpen(false);trigger.current?.focus()}
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', close)
    // The menu is portalled so mobile navigation's horizontal scrolling cannot clip it.
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])
  return <>
    <button ref={trigger} type="button" className={'rl-more-trigger' + (active ? ' active' : '')}
      aria-label="More pages" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'rl-more-menu' : undefined}
      onMouseEnter={warmFaucet} onFocus={warmFaucet}
      onClick={() => {warmFaucet();setOpen(value => !value)}}
      onKeyDown={event => {if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault();warmFaucet();setOpen(true)}}}>
      <MoreHorizontal size={22} aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={menu} id="rl-more-menu" className="rl-more-menu" role="menu" aria-label="More pages"
      style={position} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget as Node) && !trigger.current?.contains(event.relatedTarget as Node)) setOpen(false)}}
      onKeyDown={event => {if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {event.preventDefault();item.current?.focus()}}}>
      <Link ref={item} role="menuitem" to="/reality/faucet" aria-current={active ? 'page' : undefined}
        onClick={() => setOpen(false)}><Droplets size={18} aria-hidden="true"/>Faucet</Link>
    </div>, document.body)}
  </>
}
