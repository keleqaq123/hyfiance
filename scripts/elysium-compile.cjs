const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const project of ['swap','markets','nft']){
 const cwd=path.join(root,'contracts',project);
 const result=spawnSync(process.execPath,[path.join(cwd,'node_modules/hardhat/internal/cli/cli.js'),'compile'],{cwd,stdio:'inherit',timeout:600000});
 if(result.status!==0)process.exit(result.status||1);
}
