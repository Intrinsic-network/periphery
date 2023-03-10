import { Fixture } from 'ethereum-waffle'
import { ethers } from 'hardhat'
import { v3RouterFixture } from './externalFixtures'
import { constants } from 'ethers'
import {
  IWRBTC,
  MockTimeNonfungiblePositionManager,
  MockTimeSwapRouter,
  TestERC20,
  IIntrinsicFactory,
} from '../../typechain'

const completeFixture: Fixture<{
  wrbtc: IWRBTC
  factory: IIntrinsicFactory
  router: MockTimeSwapRouter
  nft: MockTimeNonfungiblePositionManager
  tokens: [TestERC20, TestERC20, TestERC20]
}> = async (wallets, provider) => {
  const { wrbtc, factory, router } = await v3RouterFixture(wallets, provider)

  const tokenFactory = await ethers.getContractFactory('TestERC20')
  const tokens = (await Promise.all([
    tokenFactory.deploy(constants.MaxUint256.div(2)), // do not use maxu256 to avoid overflowing
    tokenFactory.deploy(constants.MaxUint256.div(2)),
    tokenFactory.deploy(constants.MaxUint256.div(2)),
  ])) as [TestERC20, TestERC20, TestERC20]

  const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor')
  const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy()
  const positionDescriptorFactory = await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
    libraries: {
      NFTDescriptor: nftDescriptorLibrary.address,
    },
  })
  const positionDescriptor = await positionDescriptorFactory.deploy(tokens[0].address)

  const positionManagerFactory = await ethers.getContractFactory('MockTimeNonfungiblePositionManager')
  const nft = (await positionManagerFactory.deploy(
    factory.address,
    wrbtc.address,
    positionDescriptor.address
  )) as MockTimeNonfungiblePositionManager

  tokens.sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))

  return {
    wrbtc,
    factory,
    router,
    tokens,
    nft,
  }
}

export default completeFixture
