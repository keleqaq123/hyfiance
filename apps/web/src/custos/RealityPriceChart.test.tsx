import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
const bars=[{time:60,open:10,high:30,low:5,close:12,volume_eth:1,count:2},{time:180,open:12,high:14,low:8,close:9,volume_eth:2,count:2}]
const history={from:0,to:240,interval:60,indexed:true,indexed_at:240,truncated:false,candles:bars,trades:[],trade_count:4,volume_eth:3}
vi.mock('./realityClient',()=>({api:vi.fn(async()=>history),snapshotReality:()=>history,number:(n:number)=>String(n),short:(s:string)=>s}))
import RealityPriceChart,{candleBounds} from './RealityPriceChart'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:ReturnType<typeof createRoot>|undefined,host:HTMLDivElement|undefined
afterEach(()=>{act(()=>root?.unmount());host?.remove()})
it('includes high and low wicks in the visible price range',()=>{const range=candleBounds(bars);expect(range.low).toBeLessThan(5);expect(range.high).toBeGreaterThan(30);expect(candleBounds([])).toEqual({low:0,high:1})})
it('renders only real bars, colors falling candles red, and retains latest price when hovering',async()=>{
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
 await act(async()=>{root!.render(<RealityPriceChart asset={{id:'test',symbol:'TEST'} as any} config={null}/>)})
 expect(host.querySelectorAll('[data-candle-direction]')).toHaveLength(2)
 expect(host.querySelector('[data-candle-direction="up"] rect')?.getAttribute('fill')).toBe('#16a66a')
 expect(host.querySelector('[data-candle-direction="down"] rect')?.getAttribute('fill')).toBe('#ef5350')
 const svg=host.querySelector('svg.rl-chart-svg')!
 vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({left:0,width:1000} as DOMRect)
 await act(async()=>{svg.dispatchEvent(new MouseEvent('mousemove',{clientX:220,bubbles:true}))})
 expect(host.querySelector('.rl-chart-summary strong')?.textContent).toBe('9 ETH')
 expect(host.querySelector('.rl-chart-hover')?.textContent).toContain('O 10 · H 30 · L 5 · C 12')
})
