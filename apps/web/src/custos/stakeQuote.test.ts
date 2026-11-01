import {expect,it} from 'vitest'
import {assertSignedStakeQuote} from './stakeQuote'
import type {RealityConfig} from './realityClient'
const wallet='0x1111111111111111111111111111111111111111',vault='0x2222222222222222222222222222222222222222'
const config={cfi_price_source:'hyperliquid',cfi_staking:vault} as RealityConfig
const quote={source:'hyperliquid',account:wallet,vault,signature:'0x'+'ab'.repeat(65),amountWei:'1000000000000'}
it('accepts the configured Hyperliquid quote for a HYPE deposit',()=>expect(()=>assertSignedStakeQuote(config,quote,wallet,'0.000001')).not.toThrow())
it('rejects an ETH/Binance quote in the Hyperliquid flow',()=>expect(()=>assertSignedStakeQuote(config,{...quote,source:'binance'},wallet,'0.000001')).toThrow())
it('rejects mismatched wallets, vaults and amounts before requesting a transaction',()=>{
 for(const changed of [{account:vault},{vault:wallet},{amountWei:'2'},{signature:''}])expect(()=>assertSignedStakeQuote(config,{...quote,...changed},wallet,'0.000001')).toThrow()
})
