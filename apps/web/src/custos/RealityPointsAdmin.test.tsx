import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
import RealityPointsAdmin from './RealityPointsAdmin'
import {api} from './realityClient'
vi.mock('./realityClient',()=>({api:vi.fn(),short:(s:string)=>s}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:ReturnType<typeof createRoot>,container:HTMLDivElement
afterEach(()=>{act(()=>root?.unmount());container?.remove();vi.resetAllMocks()})
async function render(){vi.mocked(api).mockResolvedValue({items:[],has_more:false,profile:null});container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(<RealityPointsAdmin notify={vi.fn()}/>))}
function field(label:string){return Array.from(container.querySelectorAll('label')).find(l=>l.textContent?.startsWith(label))!.querySelector('input,textarea') as HTMLInputElement}
async function fill(label:string,value:string){const input=field(label);await act(async()=>{const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
function button(text:string){return Array.from(container.querySelectorAll('button')).find(b=>b.textContent===text)!}
async function click(text:string){await act(async()=>button(text).click())}
async function awardForm(){await fill('Recipient wallet','0x1111111111111111111111111111111111111111');await fill('Feedback reference','ticket-123');await fill('Reward reason','Useful feedback')}
it('requires a valid wallet, points and a traceable reason before enabling an award',async()=>{await render();expect(button('Award feedback points').disabled).toBe(true);await awardForm();expect(button('Award feedback points').disabled).toBe(false);await fill('Reward points','1.5');expect(button('Award feedback points').disabled).toBe(true)})
it('reuses the request ID after an uncertain failure so retry cannot issue duplicate points',async()=>{
 await render();await awardForm();vi.mocked(api).mockImplementation(async(path)=>{if(path==='/admin/points')throw Error('Network interrupted');return {items:[],has_more:false,profile:null} as any});await click('Award feedback points');await click('Award feedback points');const writes=vi.mocked(api).mock.calls.filter(c=>c[0]==='/admin/points');expect(writes).toHaveLength(2);expect((writes[0][1] as any).id).toBe((writes[1][1] as any).id);expect(container.textContent).toContain('Network interrupted');await fill('Feedback reference','ticket-456');await click('Award feedback points');const last=vi.mocked(api).mock.calls.filter(c=>c[0]==='/admin/points').at(-1)!;expect((last[1] as any).id).not.toBe((writes[0][1] as any).id)
})
it('checks a historical stake using the recipient and exact transaction without sending a wallet transaction',async()=>{await render();await fill('Recipient wallet','0x1111111111111111111111111111111111111111');const hash='0x'+'a'.repeat(64);await fill('Staking transaction hash',hash);await click('Verify & recover stake points');expect(api).toHaveBeenCalledWith('/admin/staking/verify',{wallet:'0x1111111111111111111111111111111111111111',tx_hash:hash})})
