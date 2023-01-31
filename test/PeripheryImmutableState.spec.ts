import { Contract } from 'ethers'
import { waffle, ethers } from 'hardhat'

import { Fixture } from 'ethereum-waffle'
import { PeripheryImmutableStateTest, IWRBTC } from '../typechain'
import { expect } from './shared/expect'
import { v3RouterFixture } from './shared/externalFixtures'

describe('PeripheryImmutableState', () => {
  const wallets = waffle.provider.getWallets()

  const nonfungiblePositionManagerFixture: Fixture<{
    wrbtc: IWRBTC
    factory: Contract
    state: PeripheryImmutableStateTest
  }> = async (wallets, provider) => {
    const { wrbtc, factory } = await v3RouterFixture(wallets, provider)

    const stateFactory = await ethers.getContractFactory('PeripheryImmutableStateTest')
    const state = (await stateFactory.deploy(factory.address, wrbtc.address)) as PeripheryImmutableStateTest

    return {
      wrbtc,
      factory,
      state,
    }
  }

  let factory: Contract
  let wrbtc: IWRBTC
  let state: PeripheryImmutableStateTest

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>

  before('create fixture loader', async () => {
    loadFixture = waffle.createFixtureLoader(wallets)
  })

  beforeEach('load fixture', async () => {
    ;({ state, wrbtc, factory } = await loadFixture(nonfungiblePositionManagerFixture))
  })

  it('bytecode size', async () => {
    expect(((await state.provider.getCode(state.address)).length - 2) / 2).to.matchSnapshot()
  })

  describe('#WRBTC', () => {
    it('points to WRBTC', async () => {
      expect(await state.WRBTC()).to.eq(wrbtc.address)
    })
  })

  describe('#factory', () => {
    it('points to v3 core factory', async () => {
      expect(await state.factory()).to.eq(factory.address)
    })
  })
})
