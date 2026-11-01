import {utils} from 'ethers'
import type {RealityConfig} from './realityClient'

export function assertSignedStakeQuote(config:RealityConfig,quote:{source?:string;signature?:string;account?:string;amountWei?:string;vault?:string},wallet:string,amount:string){
 if(!['binance','hyperliquid'].includes(config.cfi_price_source||'')||quote.source!==config.cfi_price_source||!quote.signature||quote.account?.toLowerCase()!==wallet.toLowerCase()||quote.amountWei!==utils.parseEther(amount).toString()||quote.vault?.toLowerCase()!==config.cfi_staking?.toLowerCase()){
  throw new Error('The staking quote does not match this wallet, amount or configured price source. Request a fresh quote.')
 }
}
