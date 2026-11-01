import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {Link} from 'react-router-dom'
import {afterEach,expect,test,vi} from 'vitest'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const deferred=vi.hoisted(()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}})
vi.mock('../custos/CustosLandingPage',()=>({default:()=> <div><h1>Home</h1><Link to="/reality">Explore Reality</Link></div>}))
vi.mock('../custos/RealityApp',async()=>{await deferred.promise;return {default:()=> <div><h1>Reality ready</h1><Link to="/">Home</Link></div>}})
import App from './App'
let root:ReturnType<typeof createRoot>|undefined
let container:HTMLDivElement|undefined
afterEach(()=>{act(()=>root?.unmount());container?.remove();window.location.hash='/'})
test('keeps hash navigation subscribed while a cold route module is suspended',async()=>{
 window.location.hash='/'
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)
 await act(async()=>{root!.render(<App/>)})
 await vi.waitFor(()=>expect(container!.querySelector('h1')?.textContent).toBe('Home'))
 await act(async()=>{container!.querySelector('a')!.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}))})
 await vi.waitFor(()=>expect(container!.textContent).toContain('Opening Custos'))
 await act(async()=>{deferred.resolve();await deferred.promise})
 await vi.waitFor(()=>expect(container!.querySelector('h1')?.textContent).toBe('Reality ready'))
 await act(async()=>{container!.querySelector('a')!.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}))})
 await vi.waitFor(()=>expect(container!.querySelector('h1')?.textContent).toBe('Home'))
})
