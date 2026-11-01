import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach,expect,it,vi} from 'vitest'
import RealityApp,{CreatePanel} from './RealityApp'
import * as client from './realityClient'
import PageErrorBoundary from '../components/PageErrorBoundary'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:ReturnType<typeof createRoot>|undefined,container:HTMLDivElement|undefined
afterEach(()=>{act(()=>root?.unmount());container?.remove();vi.restoreAllMocks()})
it('updates the creation mode from navigation without losing the entered project fields',async()=>{
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)
 const render=(mode:string)=>root!.render(<MemoryRouter><CreatePanel session={null} config={null} connect={vi.fn()} notify={vi.fn()} go={vi.fn()} mode={mode}/></MemoryRouter>)
 await act(async()=>render('free'))
 const name=container.querySelector<HTMLInputElement>('input[placeholder="For example: My father’s old camera"]')!
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'My Camera');name.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>render('verified'))
 expect(container.textContent).toContain('Blue V application · Human review required');expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Continue to evidence upload');expect(name.value).toBe('My Camera')
 await act(async()=>render('free'))
 expect(container.textContent).not.toContain('Blue V application · Human review required');expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Save project and continue');expect(name.value).toBe('My Camera')
})

it('keeps the creation page open when translated wallet text gets a loading icon',async()=>{
 vi.spyOn(client,'api').mockResolvedValue({name:'GIWA Sepolia'})
 vi.spyOn(client,'ensureGiwa').mockImplementation(()=>new Promise(()=>{}))
 vi.spyOn(console,'error').mockImplementation(()=>{})
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)
 await act(async()=>root!.render(<MemoryRouter initialEntries={['/reality/create']}><PageErrorBoundary><RealityApp/></PageErrorBoundary></MemoryRouter>))
 const button=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Connect wallet')!
 // Browser translation replaces React-owned text with nested font elements.
 const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT)
 const text=walker.nextNode()!
 const translation=document.createElement('font');translation.textContent='连接钱包'
 text.parentNode!.replaceChild(translation,text)
 await act(async()=>button.click())
 expect(container.textContent).toContain('Create a real project')
 expect(container.textContent).not.toContain('This page could not be opened')
 expect(button.querySelector('svg.spin')).not.toBeNull()
})
