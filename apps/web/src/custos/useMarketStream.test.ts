import {expect,it} from 'vitest'
import {hasLivePythQuote,type Quote} from './useMarketStream'
const now=1790901000000
const quote={source:'pyth-pro-websocket',fresh:true,price:2000,feedUpdateTimestampUs:now*1000} as Quote
it('accepts a fresh verified upstream price',()=>{expect(hasLivePythQuote(quote,now)).toBe(true)})
it('does not label mock or fallback prices as a live Pyth stream',()=>{
 expect(hasLivePythQuote({...quote,source:'testnet-fallback'},now)).toBe(false)
 expect(hasLivePythQuote({...quote,source:'local-mock'},now)).toBe(false)
 expect(hasLivePythQuote(null,now)).toBe(false)
})
it('rejects stale or future timestamps even when an old snapshot says fresh',()=>{
 expect(hasLivePythQuote({...quote,feedUpdateTimestampUs:(now-16000)*1000},now)).toBe(false)
 expect(hasLivePythQuote({...quote,feedUpdateTimestampUs:(now+16000)*1000},now)).toBe(false)
 expect(hasLivePythQuote({...quote,fresh:false},now)).toBe(false)
})
it('rejects invalid market prices and timestamps',()=>{
 for(const price of [NaN,Infinity,0,-1])expect(hasLivePythQuote({...quote,price},now)).toBe(false)
 expect(hasLivePythQuote({...quote,feedUpdateTimestampUs:NaN},now)).toBe(false)
})
