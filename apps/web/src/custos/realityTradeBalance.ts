import {BigNumber,Contract,utils} from 'ethers'
import {readonly,RealityAsset,RealityConfig,tokenABI} from './realityClient'

export type TradeBalance={eth:BigNumber;tokens:BigNumber;gasReserve:BigNumber;available:BigNumber}
export function percentageAmount(balance:BigNumber,percent:string){
 if(!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(percent))throw new Error('Enter a percentage greater than 0 and at most 100 (up to 2 decimal places).')
 const units=utils.parseUnits(percent,2)
 if(units.lte(0)||units.gt(10000))throw new Error('Enter a percentage greater than 0 and at most 100.')
 return utils.formatEther(balance.mul(units).div(10000))
}
export async function readTradeBalance(config:RealityConfig,asset:RealityAsset,wallet:string):Promise<TradeBalance>{
 const provider=readonly(config),token=new Contract(asset.token_address!,tokenABI,provider)
 const [eth,tokens,fees]=await Promise.all([provider.getBalance(wallet),token.balanceOf(wallet),provider.getFeeData()])
 const fee=fees.maxFeePerGas||fees.gasPrice
 if(!fee)throw new Error('Gas estimate unavailable. Retry before selecting a percentage.')
 // A conservative allowance for execution plus rollup data fees, not a fee quote.
 const gasReserve=fee.mul(500000).mul(2).add(utils.parseEther('0.00002'))
 return {eth,tokens,gasReserve,available:eth.gt(gasReserve)?eth.sub(gasReserve):BigNumber.from(0)}
}
