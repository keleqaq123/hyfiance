const {spawn} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const python = process.env.HYFIANCE_PYTHON || (process.platform === 'win32' ? path.join(root,'.venv/Scripts/python.exe') : path.join(root,'.venv/bin/python'));
if (!fs.existsSync(python)) throw Error('Create a repo .venv and install apps/api/requirements.txt, or set HYFIANCE_PYTHON to an existing environment Python.');
const children = [
  spawn(python,['-m','uvicorn','main:app','--host','127.0.0.1','--port','8001'],{cwd:path.join(root,'apps/api'),stdio:'inherit'}),
  spawn(process.execPath,[path.join(root,'apps/web/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','3001','--strictPort'],{cwd:path.join(root,'apps/web'),stdio:'inherit'}),
];
const manifest=JSON.parse(fs.readFileSync(path.join(root,'deployments/elysium-testnet.json'),'utf8'));
if(manifest.modules?.markets==='confirmed')children.push(spawn(process.execPath,['scripts/elysium-oracle.cjs','--watch'],{cwd:root,stdio:'inherit'}));
function stop(){for(const child of children)child.kill();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const child of children){child.on('error',error=>{console.error(error.message);stop();process.exitCode=1});child.on('exit',code=>{if(code){stop();process.exitCode=code;}});}
console.log('Hyfiance: http://127.0.0.1:3001 · API: http://127.0.0.1:8001/docs');
