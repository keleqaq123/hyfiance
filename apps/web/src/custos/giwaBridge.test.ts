import {beforeEach,describe,expect,it,vi} from 'vitest'
import {parseEther,TransactionReceiptNotFoundError} from 'viem'
const actions=vi.hoisted(()=>({deposit:vi.fn(),withdraw:vi.fn(),prove:vi.fn(),finalize:vi.fn(),deposits:vi.fn(),withdrawals:vi.fn()}))
vi.mock('viem',async()=>({...await vi.importActual<typeof import('viem')>('viem'),createWalletClient:()=>({sendTransaction:actions.deposit,extend:()=>({depositTransaction:actions.deposit,initiateWithdrawal:actions.withdraw,proveWithdrawal:actions.prove,finalizeWithdrawal:actions.finalize})})}))
vi.mock('viem/op-stack',async()=>({...await vi.importActual<typeof import('viem/op-stack')>('viem/op-stack'),getL2TransactionHashes:actions.deposits,getWithdrawals:actions.withdrawals}))
import {bridgeL1,bridgeL2,inspectBridge,startBridge,progressWithdrawal,loadBridgeRecords,mergeBridgeRecord,positiveAmount,verifyBridgeNetwork,invalidateBridgeVerification,portal,passer,type BridgeRecord} from './giwaBridge'
const account='0x1111111111111111111111111111111111111111',hash=('0x'+'a'.repeat(64)) as `0x${string}`,delivery=('0x'+'b'.repeat(64)) as `0x${string}`
const record:BridgeRecord={account,hash,amount:'0.01',direction:'deposit',createdAt:1,status:'submitted'}
beforeEach(()=>{
  vi.restoreAllMocks();vi.resetAllMocks();invalidateBridgeVerification()
  vi.spyOn(bridgeL1,'getChainId').mockResolvedValue(11155111);vi.spyOn(bridgeL2,'getChainId').mockResolvedValue(91342)
  vi.spyOn(bridgeL1,'getCode').mockResolvedValue('0x1234');vi.spyOn(bridgeL2,'getCode').mockResolvedValue('0x1234')
  vi.spyOn(bridgeL1,'estimateGas').mockResolvedValue(61000n);vi.spyOn(bridgeL1,'call').mockResolvedValue({data:'0x'});vi.spyOn(bridgeL1,'getBalance').mockResolvedValue(parseEther('1'));vi.spyOn(bridgeL2,'getBalance').mockResolvedValue(parseEther('1'))
  ;(window as any).ethereum={request:vi.fn(async({method,params})=>method==='eth_accounts'?[account]:method==='eth_chainId'?'0xaa36a7':params)}
})
describe('native ETH bridge',()=>{
  it('rejects zero and negative amounts',()=>{expect(()=>positiveAmount('0')).toThrow();expect(()=>positiveAmount('-1')).toThrow();expect(positiveAmount('.01')).toBe(parseEther('.01'))})
  it('disables transactions when a chain or contract is wrong',async()=>{vi.mocked(bridgeL2.getChainId).mockResolvedValue(1);await expect(verifyBridgeNetwork()).rejects.toThrow('configuration');vi.mocked(bridgeL2.getChainId).mockResolvedValue(91342);vi.mocked(bridgeL1.getCode).mockResolvedValue('0x');await expect(verifyBridgeNetwork()).rejects.toThrow('configuration')})
  it('reuses display verification but forces a fresh check before a write',async()=>{await verifyBridgeNetwork();await verifyBridgeNetwork();expect(bridgeL1.getChainId).toHaveBeenCalledTimes(1);vi.mocked(bridgeL1.getCode).mockResolvedValue('0x');await expect(startBridge('deposit',account,'.01')).rejects.toThrow('configuration');expect(actions.deposit).not.toHaveBeenCalled()})
  it('sends a native deposit to the connected wallet through the official bridge',async()=>{
    vi.spyOn(bridgeL2,'buildDepositTransaction').mockResolvedValue({account:undefined,request:{mint:parseEther('.01'),gas:21000n,to:account}} as any)
    actions.deposit.mockResolvedValue(hash);expect(await startBridge('deposit',account,'.01')).toBe(hash)
    expect(actions.deposit.mock.calls[0][0]).toMatchObject({account,to:portal,value:parseEther('.01'),gas:200000n,chain:{id:11155111}})
  })
  it('does not send when the buffered deposit simulation fails',async()=>{
    vi.spyOn(bridgeL2,'buildDepositTransaction').mockResolvedValue({request:{mint:parseEther('.01'),to:account,gas:21000n}} as any)
    vi.mocked(bridgeL1.call).mockRejectedValue(new Error('execution reverted'))
    await expect(startBridge('deposit',account,'.01')).rejects.toThrow('execution reverted')
    expect(actions.deposit).not.toHaveBeenCalled()
  })
  it('keeps gas funds and blocks a changed wallet',async()=>{await expect(startBridge('deposit',account,'1')).rejects.toThrow('network fees');await expect(startBridge('deposit','0x2222222222222222222222222222222222222222','.01')).rejects.toThrow('Wallet changed');expect(actions.deposit).not.toHaveBeenCalled()})
  it('switches to GIWA and initiates a native withdrawal',async()=>{
    ;(window as any).ethereum.request=vi.fn(async({method})=>method==='eth_accounts'?[account]:method==='eth_chainId'?'0x164ce':null)
    vi.spyOn(bridgeL1,'buildInitiateWithdrawal').mockResolvedValue({account:undefined,request:{to:account,value:parseEther('.01'),gas:21000n}} as any)
    actions.withdraw.mockResolvedValue(hash);expect(await startBridge('withdraw',account,'.01')).toBe(hash)
    expect((window as any).ethereum.request).toHaveBeenCalledWith({method:'wallet_switchEthereumChain',params:[{chainId:'0x164ce'}]})
    expect(actions.withdraw.mock.calls[0][0]).toMatchObject({chain:{id:91342},request:{to:account,value:parseEther('.01')}})
  })
  it('does not report deposit completion until the L2 receipt confirms delivery',async()=>{
    vi.spyOn(bridgeL1,'getTransaction').mockResolvedValue({from:account,to:portal,value:parseEther('.01')} as any)
    vi.spyOn(bridgeL1,'getTransactionReceipt').mockResolvedValue({status:'success',logs:[]} as any)
    actions.deposits.mockReturnValue([delivery]);vi.spyOn(bridgeL2,'getTransactionReceipt').mockRejectedValue(new TransactionReceiptNotFoundError({hash:delivery}))
    expect((await inspectBridge(record)).status).toBe('relaying')
    vi.mocked(bridgeL2.getTransactionReceipt).mockResolvedValue({status:'success'} as any);vi.spyOn(bridgeL2,'getTransaction').mockResolvedValue({to:account,value:parseEther('.01')} as any)
    expect((await inspectBridge(record)).status).toBe('completed')
  })
  it('rejects unrelated transactions and distinguishes reverts from RPC outages',async()=>{
    vi.spyOn(bridgeL1,'getTransaction').mockResolvedValue({from:account,to:passer,value:1n} as any);await expect(inspectBridge(record)).rejects.toThrow('not a supported')
    vi.mocked(bridgeL1.getTransaction).mockResolvedValue({from:account,to:portal,value:1n} as any);vi.spyOn(bridgeL1,'getTransactionReceipt').mockResolvedValue({status:'reverted'} as any);expect((await inspectBridge(record)).status).toBe('failed')
    vi.mocked(bridgeL1.getTransactionReceipt).mockRejectedValue(new Error('RPC unavailable'));await expect(inspectBridge(record)).rejects.toThrow('RPC unavailable')
  })
  it('checks chain readiness before allowing proof or claim',async()=>{
    vi.spyOn(bridgeL2,'getTransaction').mockResolvedValue({from:account,to:passer,value:1n} as any);vi.spyOn(bridgeL2,'getTransactionReceipt').mockResolvedValue({status:'success',logs:[],blockNumber:1n} as any)
    actions.withdrawals.mockReturnValue([{sender:account,target:account,value:1n,data:'0x'}]);vi.spyOn(bridgeL1,'getWithdrawalStatus').mockResolvedValue('waiting-to-prove')
    await expect(progressWithdrawal({...record,direction:'withdraw'},'prove')).rejects.toThrow('not ready');expect(actions.prove).not.toHaveBeenCalled();expect(actions.finalize).not.toHaveBeenCalled()
  })
  it('builds proof from the published dispute game and finalizes only when ready',async()=>{
    const withdrawal={sender:account,target:account,value:1n,data:'0x',withdrawalHash:hash}
    vi.spyOn(bridgeL2,'getTransaction').mockResolvedValue({from:account,to:passer,value:1n} as any);vi.spyOn(bridgeL2,'getTransactionReceipt').mockResolvedValue({status:'success',logs:[],blockNumber:12n} as any)
    actions.withdrawals.mockReturnValue([withdrawal]);vi.spyOn(bridgeL1,'getWithdrawalStatus').mockResolvedValue('ready-to-prove')
    const game={index:2n,rootClaim:hash};vi.spyOn(bridgeL1,'getGame').mockResolvedValue(game as any);vi.spyOn(bridgeL2,'buildProveWithdrawal').mockResolvedValue({withdrawal,disputeGameIndex:2n} as any)
    actions.prove.mockResolvedValue(hash);expect(await progressWithdrawal({...record,direction:'withdraw'},'prove')).toBe(hash)
    expect(bridgeL2.buildProveWithdrawal).toHaveBeenCalledWith({account,game,withdrawal})
    vi.mocked(bridgeL1.getWithdrawalStatus).mockResolvedValue('ready-to-finalize');actions.finalize.mockResolvedValue(delivery)
    expect(await progressWithdrawal({...record,direction:'withdraw'},'finalize')).toBe(delivery)
    expect(actions.finalize.mock.calls[0][0]).toMatchObject({account,withdrawal,targetChain:{id:91342},chain:{id:11155111}})
  })
  it('recovers valid history and deduplicates records',()=>{
    expect(loadBridgeRecords({getItem:()=>'{bad'})).toEqual([])
    expect(loadBridgeRecords({getItem:()=>JSON.stringify([record,{...record,hash:'bad'}])})).toEqual([record])
    expect(mergeBridgeRecord([record],{...record,status:'completed'})).toEqual([{...record,status:'completed'}])
  })
})
