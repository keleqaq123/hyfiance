import {BigNumber,Contract,utils} from 'ethers'
import {readonly,RealityConfig} from './realityClient'
// Verified GIWA Sepolia deployment; shared by all visitors, independent of browser storage.
export const nftAddress='0xF2B200A8a90cB40f08e91CE1539260556719d691'
export const nftAbi=['function name() view returns(string)','function MAX_SUPPLY() view returns(uint256)','function WALLET_LIMIT() view returns(uint256)','function mintPrice() view returns(uint256)','function totalSupply() view returns(uint256)','function mintOpen() view returns(bool)','function mintedByWallet(address) view returns(uint256)','function publicMint(uint256 quantity) payable']
export type NftState={name:string;supply:number;max:number;limit:number;price:BigNumber;open:boolean;minted:number}
export async function readNftState(config:RealityConfig,wallet:string,address=nftAddress):Promise<NftState>{
 if(!utils.isAddress(address))throw new Error('The KBW 2026 collection has not been deployed yet')
 const provider=readonly(config),collection=new Contract(address,nftAbi,provider)
 const methods=['name','totalSupply','MAX_SUPPLY','WALLET_LIMIT','mintPrice','mintOpen',...(wallet?['mintedByWallet']:[])]
 const multicall=new Contract('0xcA11bde05977b3631167028862bE2a173976CA11',['function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns(tuple(bool success,bytes returnData)[] returnData)'],provider)
 const calls=methods.map(method=>({target:address,allowFailure:false,callData:collection.interface.encodeFunctionData(method,method==='mintedByWallet'?[wallet]:[])}))
 const results=await multicall.callStatic.aggregate3(calls)
 const values=results.map((result:{success:boolean;returnData:string},i:number)=>{if(!result.success)throw new Error('NFT contract read unavailable');return collection.interface.decodeFunctionResult(methods[i],result.returnData)[0]})
 const [name,supply,max,limit,price,open,minted=BigNumber.from(0)]=values
 if(!max.eq(2026)||!price.isZero()||!limit.eq(1))throw new Error('Unexpected KBW 2026 collection rules')
 return {name,supply:supply.toNumber(),max:max.toNumber(),limit:limit.toNumber(),price,open,minted:minted.toNumber()}
}
