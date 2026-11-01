const { loadConfig } = require('./config.cjs');
const { BridgeRelayer } = require('./relayer.cjs');

async function main() {
  const relayer = new BridgeRelayer(loadConfig());
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ at: new Date().toISOString(), level: 'info', message: `received ${signal}` }));
    await relayer.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  await relayer.start();
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
