import { abi as POOL_ABI } from '@intrinsic-network/core/artifacts/contracts/IntrinsicPool.sol/IntrinsicPool.json'
import { Contract, Wallet } from 'ethers'
import { IIntrinsicPool } from '../../typechain'

export default function poolAtAddress(address: string, wallet: Wallet): IIntrinsicPool {
  return new Contract(address, POOL_ABI, wallet) as IIntrinsicPool
}
