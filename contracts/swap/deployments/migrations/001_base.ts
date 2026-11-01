import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function f(hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();




}

f.tags = ['main']