type WalletEvents={on?:(event:string,handler:(value:unknown)=>void)=>void;removeListener?:(event:string,handler:(value:unknown)=>void)=>void}
// Bridge network switches keep wallet identity; account changes always revoke the session.
export function listenRealityWallet(provider:WalletEvents|undefined,bridge:boolean,clear:()=>void,invalidate:()=>void){
 if(!provider?.on)return ()=>{}
 const accountChanged=()=>clear()
 const networkChanged=(chain:unknown)=>{const id=typeof chain==='string'||typeof chain==='number'?Number(chain):NaN;if(bridge&&(id===11155111||id===91342))invalidate();else clear()}
 provider.on('accountsChanged',accountChanged);provider.on('chainChanged',networkChanged)
 return ()=>{provider.removeListener?.('accountsChanged',accountChanged);provider.removeListener?.('chainChanged',networkChanged)}
}
