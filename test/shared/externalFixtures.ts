import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from '@intrinsic-network/core/artifacts/contracts/IntrinsicFactory.sol/IntrinsicFactory.json'
import { abi as FACTORY_V2_ABI, bytecode as FACTORY_V2_BYTECODE } from '@uniswap/v2-core/build/UniswapV2Factory.json'
import { Fixture } from 'ethereum-waffle'
import { ethers, waffle } from 'hardhat'
import { IIntrinsicFactory, IWRBTC, MockTimeSwapRouter } from '../../typechain'

import WRBTC from '../contracts/WRBTC.json'
import { Contract } from '@ethersproject/contracts'
import { constants } from 'ethers'

const wrbtcFixture: Fixture<{ wrbtc: IWRBTC }> = async ([wallet]) => {
  const wrbtc = (await waffle.deployContract(wallet, {
    bytecode: WRBTC.bytecode,
    abi: WRBTC.abi,
  })) as IWRBTC

  return { wrbtc }
}

export const v2FactoryFixture: Fixture<{ factory: Contract }> = async ([wallet]) => {
  const factory = await waffle.deployContract(
    wallet,
    {
      bytecode: FACTORY_V2_BYTECODE,
      abi: FACTORY_V2_ABI,
    },
    [constants.AddressZero]
  )

  return { factory }
}

const v3CoreFactoryFixture: Fixture<IIntrinsicFactory> = async ([wallet]) => {
  return (await waffle.deployContract(wallet, {
    bytecode: FACTORY_BYTECODE,
    abi: FACTORY_ABI,
  })) as IIntrinsicFactory
}

export const v3RouterFixture: Fixture<{
  wrbtc: IWRBTC
  factory: IIntrinsicFactory
  router: MockTimeSwapRouter
}> = async ([wallet], provider) => {
  const { wrbtc } = await wrbtcFixture([wallet], provider)
  const factory = await v3CoreFactoryFixture([wallet], provider)

  const router = (await (await ethers.getContractFactory('MockTimeSwapRouter')).deploy(
    factory.address,
    wrbtc.address
  )) as MockTimeSwapRouter

  return { factory, wrbtc, router }
}
