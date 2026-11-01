import {createPublicClient, createWalletClient, custom, http, encodeFunctionData, parseAbi, parseEther, formatEther, getAddress, type Address, type Hash, TransactionReceiptNotFoundError} from 'viem'
import {sepolia, giwaSepolia} from 'viem/chains'
import {publicActionsL1, publicActionsL2, walletActionsL1, walletActionsL2, getL2TransactionHashes, getWithdrawals} from 'viem/op-stack'
import {RealityReadCache} from './realityReadCache'

export type BridgeDirection = 'deposit' | 'withdraw'
export type BridgeStatus = 'submitted'|'relaying'|'waiting-to-prove'|'ready-to-prove'|'proving'|'waiting-to-finalize'|'ready-to-finalize'|'finalizing'|'completed'|'failed'
export type BridgeRecord = {hash: Hash; account: Address; direction: BridgeDirection; amount: string; createdAt: number; status: BridgeStatus; l2Hash?: Hash; proveHash?: Hash; finalizeHash?: Hash; error?: string}
const base = (import.meta.env.VITE_API_BASE || '').replace(/\/$/,'') || window.location.origin
export const bridgeL1 = createPublicClient({chain: sepolia, transport: http(base+'/api/reality/bridge/rpc/sepolia',{timeout:20000,retryCount:1}),batch:{multicall:false}}).extend(publicActionsL1())
export const bridgeL2 = createPublicClient({chain: giwaSepolia, transport: http(base+'/api/reality/bridge/rpc/giwa',{timeout:20000,retryCount:1}),batch:{multicall:false}}).extend(publicActionsL2())
export const portal = giwaSepolia.contracts.portal[sepolia.id].address
export const passer = giwaSepolia.contracts.l2ToL1MessagePasser.address
export const STORAGE_KEY = 'custos.giwa.eth.bridge.v1'
export const statusText: Record<BridgeStatus,string> = {submitted:'Confirming source transaction',relaying:'Waiting for GIWA delivery','waiting-to-prove':'Waiting for withdrawal proof','ready-to-prove':'Ready to prove',proving:'Confirming proof','waiting-to-finalize':'Challenge period','ready-to-finalize':'Ready to claim',finalizing:'Confirming claim',completed:'Completed',failed:'Transaction reverted'}
export function positiveAmount(value:string){const amount=parseEther(value);if(amount<=0n)throw new Error('Enter an ETH amount greater than zero.');return amount}
export function isHash(value:string):value is Hash{return /^0x[0-9a-fA-F]{64}$/.test(value)}
export function loadBridgeRecords(storage: Pick<Storage,'getItem'>=localStorage):BridgeRecord[]{
  try{const data=JSON.parse(storage.getItem(STORAGE_KEY)||'[]');if(!Array.isArray(data))return [];return data.filter((r:any)=>isHash(r.hash||'')&&/^0x[0-9a-fA-F]{40}$/.test(r.account||'')&&['deposit','withdraw'].includes(r.direction)&&Object.keys(statusText).includes(r.status)&&typeof r.amount==='string'&&Number.isFinite(r.createdAt)).slice(0,1000)}catch{return []}
}
export function saveBridgeRecords(records:BridgeRecord[]){localStorage.setItem(STORAGE_KEY,JSON.stringify(records.slice(0,1000)))}
export function mergeBridgeRecord(records:BridgeRecord[],record:BridgeRecord){return [record,...records.filter(r=>r.hash.toLowerCase()!==record.hash.toLowerCase())].sort((a,b)=>b.createdAt-a.createdAt)}
const bridgeChecks=new RealityReadCache()
export function invalidateBridgeVerification(){bridgeChecks.clear()}
export async function verifyBridgeNetwork(force=false){
  if(force)bridgeChecks.clear()
  return bridgeChecks.read('official-contracts',30000,async()=>{
  const [l1,l2,code,messageCode]=await Promise.all([bridgeL1.getChainId(),bridgeL2.getChainId(),bridgeL1.getCode({address:portal}),bridgeL2.getCode({address:passer})])
  if(l1!==sepolia.id||l2!==giwaSepolia.id||!code||code==='0x'||!messageCode||messageCode==='0x')throw new Error('Bridge network or official contract configuration does not match. Transactions are disabled.')
  return true
  })
}
export async function bridgeAccount(request=false):Promise<Address>{
  const provider=(window as any).ethereum
  if(!provider)throw new Error('Open Custos in a browser with MetaMask or OKX Wallet installed.')
  const accounts=await provider.request({method:request?'eth_requestAccounts':'eth_accounts'})
  if(!accounts?.[0])throw new Error('Connect your wallet to continue.')
  return getAddress(accounts[0])
}
async function wallet(direction:BridgeDirection,account:Address){
  const provider=(window as any).ethereum,chain=direction==='deposit'?sepolia:giwaSepolia
  if((await bridgeAccount()).toLowerCase()!==account.toLowerCase())throw new Error('Wallet changed. Reconnect and retry.')
  const chainHex='0x'+chain.id.toString(16)
  try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex}]})}catch(error:any){
    if(error.code!==4902&&error?.data?.originalError?.code!==4902)throw error
    await provider.request({method:'wallet_addEthereumChain',params:[{chainId:chainHex,chainName:chain.name,nativeCurrency:chain.nativeCurrency,rpcUrls:[direction==='deposit'?'https://ethereum-sepolia-rpc.publicnode.com':'https://sepolia-rpc.giwa.io'],blockExplorerUrls:[chain.blockExplorers.default.url]}]})
    await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex}]})
  }
  if(Number(await provider.request({method:'eth_chainId'}))!==chain.id||(await bridgeAccount()).toLowerCase()!==account.toLowerCase())throw new Error('Wallet network or account does not match.')
  return createWalletClient({account,chain,transport:custom(provider)} )
}
export async function startBridge(direction:BridgeDirection,account:Address,amount:string,onGas?:(gas:bigint)=>void):Promise<Hash>{
  const value=positiveAmount(amount);await verifyBridgeNetwork(true)
  const client=await wallet(direction,account)
  const balance=await (direction==='deposit'?bridgeL1:bridgeL2).getBalance({address:account})
  if(value>=balance)throw new Error('Insufficient ETH. Keep some ETH for network fees.')
  if(direction==='deposit'){
    const args=await bridgeL2.buildDepositTransaction({account,mint:value,to:account})
    const request=args.request
    const data=encodeFunctionData({abi:parseAbi(['function depositTransaction(address to, uint256 value, uint64 gasLimit, bool isCreation, bytes data) payable']),functionName:'depositTransaction',args:[request.to??account,request.value??request.mint??0n,request.gas,request.isCreation??false,request.data??'0x']})
    const transaction={account,to:portal,value:request.mint,data}
    const estimate=await bridgeL1.estimateGas(transaction)
    // Portal resource metering can require more gas than a tight RPC estimate.
    const buffered=estimate+estimate/2n+30000n
    const gas=buffered<200000n?200000n:buffered
    await bridgeL1.call({...transaction,gas})
    onGas?.(gas)
    return client.sendTransaction({...transaction,gas,chain:sepolia})
  }
  const args=await bridgeL1.buildInitiateWithdrawal({account,to:account,value})
  return client.extend(walletActionsL2()).initiateWithdrawal({...args,chain:giwaSepolia})
}
async function receipt(hash:Hash,direction:BridgeDirection){try{return await (direction==='deposit'?bridgeL1:bridgeL2).getTransactionReceipt({hash})}catch(error){if(error instanceof TransactionReceiptNotFoundError)return null;throw error}}
export async function inspectBridge(record:BridgeRecord):Promise<BridgeRecord>{
  const source=record.direction==='deposit'?bridgeL1:bridgeL2
  const tx=await source.getTransaction({hash:record.hash})
  if(tx.from.toLowerCase()!==record.account.toLowerCase()||tx.to?.toLowerCase()!==(record.direction==='deposit'?portal:passer).toLowerCase())throw new Error('This hash is not a supported native ETH bridge transaction from your wallet.')
  const initial=await receipt(record.hash,record.direction)
  if(!initial)return {...record,status:'submitted'}
  if(initial.status==='reverted')return {...record,status:'failed'}
  if(record.direction==='deposit'){
    const [l2Hash]=getL2TransactionHashes(initial)
    if(!l2Hash)throw new Error('No ETH deposit found in this transaction.')
    const delivery=await receipt(l2Hash,'withdraw')
    if(delivery){const l2tx=await bridgeL2.getTransaction({hash:l2Hash});if(l2tx.to?.toLowerCase()!==record.account.toLowerCase()||l2tx.value<=0n)throw new Error('This deposit does not deliver native ETH to your wallet.')}
    return {...record,amount:formatEther(tx.value),l2Hash,status:!delivery?'relaying':delivery.status==='success'?'completed':'failed'}
  }
  const [withdrawal]=getWithdrawals({logs:initial.logs})
  if(!withdrawal||withdrawal.sender.toLowerCase()!==record.account.toLowerCase()||withdrawal.target.toLowerCase()!==record.account.toLowerCase()||withdrawal.value<=0n||withdrawal.data!=='0x')throw new Error('This withdrawal does not return native ETH to your wallet.')
  let next={...record,amount:formatEther(withdrawal.value)}
  for(const key of ['proveHash','finalizeHash'] as const){if(next[key]){const pending=await receipt(next[key]!,'deposit');if(!pending)return {...next,status:key==='proveHash'?'proving':'finalizing'};if(pending.status==='reverted')next={...next,[key]:undefined}}}
  const status=await bridgeL1.getWithdrawalStatus({receipt:initial,targetChain:giwaSepolia})
  return {...next,status:status==='finalized'?'completed':status}
}
export async function progressWithdrawal(record:BridgeRecord,stage:'prove'|'finalize'):Promise<Hash>{
  await verifyBridgeNetwork(true)
  const fresh=await inspectBridge(record)
  if(fresh.status!==(stage==='prove'?'ready-to-prove':'ready-to-finalize'))throw new Error('This withdrawal is not ready for that action. Refresh its status.')
  const client=(await wallet('deposit',record.account)).extend(walletActionsL1())
  const initial=await bridgeL2.getTransactionReceipt({hash:record.hash}),[withdrawal]=getWithdrawals({logs:initial.logs})
  if(stage==='prove'){
    const game=await bridgeL1.getGame({l2BlockNumber:initial.blockNumber,targetChain:giwaSepolia,strategy:'latest'})
    const args=await bridgeL2.buildProveWithdrawal({account:record.account,game,withdrawal})
    return client.proveWithdrawal({...args,chain:sepolia})
  }
  return client.finalizeWithdrawal({account:record.account,chain:sepolia,targetChain:giwaSepolia,withdrawal})
}
export async function importBridgeHash(hash:Hash,direction:BridgeDirection,account:Address){
  const blockReceipt=await receipt(hash,direction)
  const block=blockReceipt?await (direction==='deposit'?bridgeL1:bridgeL2).getBlock({blockNumber:blockReceipt.blockNumber}):null
  return inspectBridge({hash,direction,account,amount:'0',createdAt:block?Number(block.timestamp)*1000:Date.now(),status:'submitted'})
}
