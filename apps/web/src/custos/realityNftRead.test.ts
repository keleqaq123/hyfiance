import {beforeEach,expect,it,vi} from 'vitest'
import {utils} from 'ethers'
const state=vi.hoisted(()=>({aggregate:vi.fn()}))
vi.mock('./realityClient',()=>({readonly:()=>({})}))
vi.mock('ethers',async()=>{const actual=await vi.importActual<typeof import('ethers')>('ethers');return {...actual,Contract:class{interface:InstanceType<typeof actual.utils.Interface>;callStatic={aggregate3:state.aggregate};constructor(_address:string,abi:string[]){this.interface=new actual.utils.Interface(abi)}}}})
import {readNftState,nftAbi,nftAddress} from './realityNftRead'
const deployedAddress='0x1111111111111111111111111111111111111111'
const codec=new utils.Interface(nftAbi),config={rpc:'test',chain_id:91342} as any,wallet='0x1111111111111111111111111111111111111111'
beforeEach(()=>{state.aggregate.mockReset();state.aggregate.mockImplementation(async(calls:any[])=>calls.map(call=>{const tx=codec.parseTransaction({data:call.callData});const values:Record<string,any>={name:"Custos - The Builder's Mark",totalSupply:10,MAX_SUPPLY:2026,WALLET_LIMIT:1,mintPrice:'0',mintOpen:true,mintedByWallet:1};return {success:true,returnData:codec.encodeFunctionResult(tx.name,[values[tx.name]])}}))})
it('reads seven NFT fields in one call and preserves wallet-specific mint status',async()=>{
 const result=await readNftState(config,wallet,deployedAddress);expect(state.aggregate).toHaveBeenCalledTimes(1);expect(result).toMatchObject({name:"Custos - The Builder's Mark",supply:10,max:2026,limit:1,minted:1,open:true});expect(result.price.toString()).toBe('0')
 const calls=state.aggregate.mock.calls[0][0];expect(calls).toHaveLength(7);expect(calls.every((call:any)=>call.target===deployedAddress&&!call.allowFailure)).toBe(true);expect(codec.decodeFunctionData('mintedByWallet',calls[6].callData)[0]).toBe(wallet)
})
it('omits wallet calls for a disconnected visitor',async()=>{expect((await readNftState(config,'',deployedAddress)).minted).toBe(0);expect(state.aggregate.mock.calls[0][0]).toHaveLength(6)})
it('reports a failed read instead of displaying invented contract values',async()=>{state.aggregate.mockResolvedValue([{success:false,returnData:'0x'}]);await expect(readNftState(config,wallet,deployedAddress)).rejects.toThrow('unavailable')})

it('uses the verified KBW deployment without relying on browser storage',()=>{expect(nftAddress).toBe('0xF2B200A8a90cB40f08e91CE1539260556719d691')})
