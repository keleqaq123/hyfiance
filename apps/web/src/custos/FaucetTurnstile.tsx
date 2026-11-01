import React, {useEffect, useRef, useState} from 'react'

type TurnstileApi = {render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void}
let loader: Promise<TurnstileApi> | undefined
function loadTurnstile(): Promise<TurnstileApi> {
  if (!loader) loader = new Promise((resolve, reject) => {
    const win = window as any
    if (win.turnstile) {resolve(win.turnstile);return}
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    const timer = setTimeout(() => {loader = undefined;script.remove();reject(new Error('Human verification did not load. Reload to retry.'))}, 15000)
    script.onload = () => {clearTimeout(timer);if (win.turnstile) resolve(win.turnstile);else {loader = undefined;reject(new Error('Human verification unavailable.'))}}
    script.onerror = () => {clearTimeout(timer);loader = undefined;script.remove();reject(new Error('Human verification unavailable. Reload to retry.'))}
    document.head.appendChild(script)
  })
  return loader
}

export default function FaucetTurnstile({siteKey, onToken}: {siteKey: string; onToken: (token: string) => void}) {
  const host = useRef<HTMLDivElement>(null), [error, setError] = useState('')
  useEffect(() => {
    let active = true, widget: string | undefined, api: TurnstileApi | undefined
    onToken('')
    void loadTurnstile().then(value => {
      if (!active || !host.current) return
      api = value
      widget = api.render(host.current, {sitekey: siteKey, action: 'faucet', theme: 'light', size: 'flexible',
        callback: (token: string) => {if (active) onToken(token)},
        'expired-callback': () => {if (active) onToken('')},
        'error-callback': () => {if (active) {onToken('');setError('Human verification failed. Reload to retry.')}},
      })
    }).catch(reason => {if (active) setError(reason.message)})
    return () => {active = false;if (widget !== undefined) api?.remove(widget)}
  }, [siteKey, onToken])
  return <div className="rl-faucet-captcha"><div ref={host} aria-label="Human verification"/>{error ? <p role="alert">{error}</p> : null}</div>
}
