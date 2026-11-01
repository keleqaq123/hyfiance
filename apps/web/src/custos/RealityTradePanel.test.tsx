import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {BigNumber,utils} from 'ethers'
import {afterEach,expect,it,vi} from 'vitest'
import RealityTradePanel from './RealityTradePanel'
import {percentageAmount,readTradeBalance} from './realityTradeBalance'
vi.mock('./realityTradeBalance',async()=>({...await vi.importActual<any>('./realityTradeBalance'),readTradeBalance:vi.fn()}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:ReturnType<typeof createRoot>|undefined,container:HTMLDivElement
afterEach(()=>{act(()=>root?.unmount());container?.remove();vi.clearAllMocks()})
const eth=(s:string)=>utils.parseEther(s)
async function render(wallet='0x123'){
 vi.mocked(readTradeBalance).mockResolvedValue({eth:eth('1'),available:eth('0.98'),gasReserve:eth('0.02'),tokens:eth('123.456789012345678901')})
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)
 await act(async()=>root!.render(<RealityTradePanel asset={{id:'one',symbol:'TEST',token_address:'0x456'} as any} config={{rpc:'test'} as any} wallet={wallet} connect={vi.fn()} notify={vi.fn()} onConfirmed={vi.fn()}/>))
}
const button=(name:string)=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent===name)!
const click=async(name:string)=>act(async()=>button(name).click())
async function fill(input:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
it('calculates percentages with integer precision, including full holdings and fractional percentages',()=>{
 const value=eth('123.456789012345678901')
 expect(percentageAmount(value,'100')).toBe('123.456789012345678901')
 expect(percentageAmount(value,'20')).toBe(utils.formatEther(value.mul(20).div(100)))
 expect(percentageAmount(value,'12.25')).toBe(utils.formatEther(value.mul(1225).div(10000)))
 for(const invalid of ['0','100.01','-1','1e2','abc','1.234'])expect(()=>percentageAmount(BigNumber.from(100),invalid)).toThrow()
})
it('uses ETH after the gas allowance for buys, and actual token holdings for sells',async()=>{
 await render();expect(container.textContent).toContain('Wallet balance1 ETH')
 await click('100%');expect(container.querySelector('input')!.value).toBe('0.98')
 await click('Sell');expect(container.querySelector('input')!.value).toBe('');expect(container.textContent).toContain('Token holdings123.45678901 TEST')
 await click('100%');expect(container.querySelector('input')!.value).toBe('123.456789012345678901')
 await click('20%');expect(container.querySelector('input')!.value).toBe(percentageAmount(eth('123.456789012345678901'),'20'))
})
it('applies custom percentages and blocks amounts exceeding holdings',async()=>{
 await render();await click('Custom');await fill(container.querySelector('input[aria-label="Custom percentage"]')!,'12.25');await click('Apply')
 expect(container.querySelector('input')!.value).toBe('0.12005')
 await click('Sell');await fill(container.querySelector('input')!,'124')
 expect(container.textContent).toContain('Amount exceeds your token holdings.');expect(button('Confirm sell').disabled).toBe(true)
 await fill(container.querySelector('input[aria-label="Custom percentage"]')!,'101');await click('Apply');expect(container.textContent).toContain('at most 100')
})
it('shows no invented balance and disables percentage controls before sign-in',async()=>{
 await render('');expect(container.textContent).toContain('Connect wallet to view balances.');expect(button('100%').disabled).toBe(true);expect(readTradeBalance).not.toHaveBeenCalled()
})
