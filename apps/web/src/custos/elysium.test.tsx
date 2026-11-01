import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
import CustosFaucetPage from './CustosFaucetPage'
import {MARKET_NETWORK,WALLET_NETWORK,ensureMarketNetwork} from './marketNetwork'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('adds Elysium with HYPE and never adds the old GIWA chain',async()=>{
 expect(MARKET_NETWORK.chainId).toBe(99801)
 expect(WALLET_NETWORK.nativeCurrency.symbol).toBe('HYPE')
 const request=vi.fn().mockResolvedValueOnce('0x1').mockRejectedValueOnce({code:4902}).mockResolvedValueOnce(null)
 await ensureMarketNetwork({request})
 expect(request.mock.calls[2][0]).toEqual({method:'wallet_addEthereumChain',params:[WALLET_NETWORK]})
})
it('Elysium faucet uses the official destination and does not call the old sponsored faucet',async()=>{
 vi.stubEnv('VITE_CHAIN_ID','99801')
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 const container=document.createElement('div'),root=createRoot(container)
 try{
  await act(async()=>root.render(<CustosFaucetPage/>))
  expect(container.textContent).toContain('Elysium test HYPE')
  expect(container.querySelector('a')?.href).toBe('https://elysium.kinetiq.xyz/testnet-faucet')
  expect(fetch).not.toHaveBeenCalled()
 }finally{await act(async()=>root.unmount())}
})
