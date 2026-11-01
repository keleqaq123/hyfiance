const fs=require('fs'),path=require('path'),solc=require('solc');
const source='CustosCFIBinanceStake.sol';
const input={language:'Solidity',sources:{[source]:{content:fs.readFileSync(path.resolve(__dirname,'../src/'+source),'utf8')}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const out=JSON.parse(solc.compile(JSON.stringify(input)));if((out.errors||[]).some(e=>e.severity==='error'))throw Error(JSON.stringify(out.errors));
const c=out.contracts[source].CustosCFIBinanceStake,a={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object};
fs.writeFileSync(path.resolve(__dirname,'../../../apps/web/src/custos/cfi-binance-artifact.json'),JSON.stringify(a));
console.log('Binance CFI artifact compiled');
