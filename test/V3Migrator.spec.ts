import { Fixture } from 'ethereum-waffle'
import { constants, Contract } from 'ethers'
import { ethers, waffle } from 'hardhat'
import {
  IUniswapV2Pair,
  IIntrinsicFactory,
  IWRBTC,
  MockTimeNonfungiblePositionManager,
  TestERC20,
  V3Migrator,
} from '../typechain'
import completeFixture from './shared/completeFixture'
import { v2FactoryFixture } from './shared/externalFixtures'

import { abi as PAIR_V2_ABI } from '@uniswap/v2-core/build/UniswapV2Pair.json'
import { expect } from 'chai'
import { FeeAmount } from './shared/constants'
import { encodePriceSqrt } from './shared/encodePriceSqrt'
import snapshotGasCost from './shared/snapshotGasCost'
import { getMaxTick, getMinTick } from './shared/ticks'

describe('V3Migrator', () => {
  const wallets = waffle.provider.getWallets()
  const wallet = wallets[0]

  const migratorFixture: Fixture<{
    factoryV2: Contract
    factoryV3: IIntrinsicFactory
    token: TestERC20
    wrbtc: IWRBTC
    nft: MockTimeNonfungiblePositionManager
    migrator: V3Migrator
  }> = async (wallets, provider) => {
    const { factory, tokens, nft, wrbtc } = await completeFixture(wallets, provider)

    const { factory: factoryV2 } = await v2FactoryFixture(wallets, provider)

    const token = tokens[0]
    await token.approve(factoryV2.address, constants.MaxUint256)
    await wrbtc.deposit({ value: 10000 })
    await wrbtc.approve(nft.address, constants.MaxUint256)

    // deploy the migrator
    const migrator = (await (await ethers.getContractFactory('V3Migrator')).deploy(
      factory.address,
      wrbtc.address,
      nft.address
    )) as V3Migrator

    return {
      factoryV2,
      factoryV3: factory,
      token,
      wrbtc,
      nft,
      migrator,
    }
  }

  let factoryV2: Contract
  let factoryV3: IIntrinsicFactory
  let token: TestERC20
  let wrbtc: IWRBTC
  let nft: MockTimeNonfungiblePositionManager
  let migrator: V3Migrator
  let pair: IUniswapV2Pair

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>

  before('create fixture loader', async () => {
    loadFixture = waffle.createFixtureLoader(wallets)
  })

  beforeEach('load fixture', async () => {
    ;({ factoryV2, factoryV3, token, wrbtc, nft, migrator } = await loadFixture(migratorFixture))
  })

  afterEach('ensure allowances are cleared', async () => {
    const allowanceToken = await token.allowance(migrator.address, nft.address)
    const allowanceWRBTC = await wrbtc.allowance(migrator.address, nft.address)
    expect(allowanceToken).to.be.eq(0)
    expect(allowanceWRBTC).to.be.eq(0)
  })

  afterEach('ensure balances are cleared', async () => {
    const balanceToken = await token.balanceOf(migrator.address)
    const balanceWRBTC = await wrbtc.balanceOf(migrator.address)
    expect(balanceToken).to.be.eq(0)
    expect(balanceWRBTC).to.be.eq(0)
  })

  afterEach('ensure rbtc balance is cleared', async () => {
    const balanceRBTC = await ethers.provider.getBalance(migrator.address)
    expect(balanceRBTC).to.be.eq(0)
  })

  describe('#migrate', () => {
    let tokenLower: boolean

    const expectedLiquidity = 10000 - 1000

    beforeEach(() => {
      tokenLower = token.address.toLowerCase() < wrbtc.address.toLowerCase()
    })

    beforeEach('add V2 liquidity', async () => {
      await factoryV2.createPair(token.address, wrbtc.address)

      const pairAddress = await factoryV2.getPair(token.address, wrbtc.address)

      pair = new ethers.Contract(pairAddress, PAIR_V2_ABI, wallet) as IUniswapV2Pair

      await token.transfer(pair.address, 10000)
      await wrbtc.transfer(pair.address, 10000)

      await pair.mint(wallet.address)

      expect(await pair.balanceOf(wallet.address)).to.be.eq(expectedLiquidity)
    })

    it('fails if v3 pool is not initialized', async () => {
      await pair.approve(migrator.address, expectedLiquidity)
      await expect(
        migrator.migrate({
          pair: pair.address,
          liquidityToMigrate: expectedLiquidity,
          percentageToMigrate: 100,
          token0: tokenLower ? token.address : wrbtc.address,
          token1: tokenLower ? wrbtc.address : token.address,
          fee: FeeAmount.MEDIUM,
          tickLower: -1,
          tickUpper: 1,
          amount0Min: 9000,
          amount1Min: 9000,
          recipient: wallet.address,
          deadline: 1,
          refundAsRBTC: false,
        })
      ).to.be.reverted
    })

    it('works once v3 pool is initialized', async () => {
      await migrator.createAndInitializePoolIfNecessary(
        token.address,
        wrbtc.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await pair.approve(migrator.address, expectedLiquidity)
      await migrator.migrate({
        pair: pair.address,
        liquidityToMigrate: expectedLiquidity,
        percentageToMigrate: 100,
        token0: tokenLower ? token.address : wrbtc.address,
        token1: tokenLower ? wrbtc.address : token.address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(FeeAmount.MEDIUM),
        tickUpper: getMaxTick(FeeAmount.MEDIUM),
        amount0Min: 9000,
        amount1Min: 9000,
        recipient: wallet.address,
        deadline: 1,
        refundAsRBTC: false,
      })

      const position = await nft.positions(1)
      expect(position.liquidity).to.be.eq(9000)

      const poolAddress = await factoryV3.getPool(token.address, wrbtc.address, FeeAmount.MEDIUM)
      expect(await token.balanceOf(poolAddress)).to.be.eq(9000)
      expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(9000)
    })

    it('works for partial', async () => {
      await migrator.createAndInitializePoolIfNecessary(
        token.address,
        wrbtc.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const tokenBalanceBefore = await token.balanceOf(wallet.address)
      const wrbtcBalanceBefore = await wrbtc.balanceOf(wallet.address)

      await pair.approve(migrator.address, expectedLiquidity)
      await migrator.migrate({
        pair: pair.address,
        liquidityToMigrate: expectedLiquidity,
        percentageToMigrate: 50,
        token0: tokenLower ? token.address : wrbtc.address,
        token1: tokenLower ? wrbtc.address : token.address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(FeeAmount.MEDIUM),
        tickUpper: getMaxTick(FeeAmount.MEDIUM),
        amount0Min: 4500,
        amount1Min: 4500,
        recipient: wallet.address,
        deadline: 1,
        refundAsRBTC: false,
      })

      const tokenBalanceAfter = await token.balanceOf(wallet.address)
      const wrbtcBalanceAfter = await wrbtc.balanceOf(wallet.address)

      expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(4500)
      expect(wrbtcBalanceAfter.sub(wrbtcBalanceBefore)).to.be.eq(4500)

      const position = await nft.positions(1)
      expect(position.liquidity).to.be.eq(4500)

      const poolAddress = await factoryV3.getPool(token.address, wrbtc.address, FeeAmount.MEDIUM)
      expect(await token.balanceOf(poolAddress)).to.be.eq(4500)
      expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(4500)
    })

    it('double the price', async () => {
      await migrator.createAndInitializePoolIfNecessary(
        token.address,
        wrbtc.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(2, 1)
      )

      const tokenBalanceBefore = await token.balanceOf(wallet.address)
      const wrbtcBalanceBefore = await wrbtc.balanceOf(wallet.address)

      await pair.approve(migrator.address, expectedLiquidity)
      await migrator.migrate({
        pair: pair.address,
        liquidityToMigrate: expectedLiquidity,
        percentageToMigrate: 100,
        token0: tokenLower ? token.address : wrbtc.address,
        token1: tokenLower ? wrbtc.address : token.address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(FeeAmount.MEDIUM),
        tickUpper: getMaxTick(FeeAmount.MEDIUM),
        amount0Min: 4500,
        amount1Min: 8999,
        recipient: wallet.address,
        deadline: 1,
        refundAsRBTC: false,
      })

      const tokenBalanceAfter = await token.balanceOf(wallet.address)
      const wrbtcBalanceAfter = await wrbtc.balanceOf(wallet.address)

      const position = await nft.positions(1)
      expect(position.liquidity).to.be.eq(6363)

      const poolAddress = await factoryV3.getPool(token.address, wrbtc.address, FeeAmount.MEDIUM)
      if (token.address.toLowerCase() < wrbtc.address.toLowerCase()) {
        expect(await token.balanceOf(poolAddress)).to.be.eq(4500)
        expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(4500)
        expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(8999)
        expect(wrbtcBalanceAfter.sub(wrbtcBalanceBefore)).to.be.eq(1)
      } else {
        expect(await token.balanceOf(poolAddress)).to.be.eq(8999)
        expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(1)
        expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(4500)
        expect(wrbtcBalanceAfter.sub(wrbtcBalanceBefore)).to.be.eq(4500)
      }
    })

    it('half the price', async () => {
      await migrator.createAndInitializePoolIfNecessary(
        token.address,
        wrbtc.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 2)
      )

      const tokenBalanceBefore = await token.balanceOf(wallet.address)
      const wrbtcBalanceBefore = await wrbtc.balanceOf(wallet.address)

      await pair.approve(migrator.address, expectedLiquidity)
      await migrator.migrate({
        pair: pair.address,
        liquidityToMigrate: expectedLiquidity,
        percentageToMigrate: 100,
        token0: tokenLower ? token.address : wrbtc.address,
        token1: tokenLower ? wrbtc.address : token.address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(FeeAmount.MEDIUM),
        tickUpper: getMaxTick(FeeAmount.MEDIUM),
        amount0Min: 8999,
        amount1Min: 4500,
        recipient: wallet.address,
        deadline: 1,
        refundAsRBTC: false,
      })

      const tokenBalanceAfter = await token.balanceOf(wallet.address)
      const wrbtcBalanceAfter = await wrbtc.balanceOf(wallet.address)

      const position = await nft.positions(1)
      expect(position.liquidity).to.be.eq(6363)

      const poolAddress = await factoryV3.getPool(token.address, wrbtc.address, FeeAmount.MEDIUM)
      if (token.address.toLowerCase() < wrbtc.address.toLowerCase()) {
        expect(await token.balanceOf(poolAddress)).to.be.eq(8999)
        expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(1)
        expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(4500)
        expect(wrbtcBalanceAfter.sub(wrbtcBalanceBefore)).to.be.eq(4500)
      } else {
        expect(await token.balanceOf(poolAddress)).to.be.eq(4500)
        expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(4500)
        expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(8999)
        expect(wrbtcBalanceAfter.sub(wrbtcBalanceBefore)).to.be.eq(1)
      }
    })

    it('double the price - as RBTC', async () => {
      await migrator.createAndInitializePoolIfNecessary(
        token.address,
        wrbtc.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(2, 1)
      )

      const tokenBalanceBefore = await token.balanceOf(wallet.address)

      await pair.approve(migrator.address, expectedLiquidity)
      await expect(
        migrator.migrate({
          pair: pair.address,
          liquidityToMigrate: expectedLiquidity,
          percentageToMigrate: 100,
          token0: tokenLower ? token.address : wrbtc.address,
          token1: tokenLower ? wrbtc.address : token.address,
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(FeeAmount.MEDIUM),
          tickUpper: getMaxTick(FeeAmount.MEDIUM),
          amount0Min: 4500,
          amount1Min: 8999,
          recipient: wallet.address,
          deadline: 1,
          refundAsRBTC: true,
        })
      )
        .to.emit(wrbtc, 'Withdrawal')
        .withArgs(migrator.address, tokenLower ? 1 : 4500)

      const tokenBalanceAfter = await token.balanceOf(wallet.address)

      const position = await nft.positions(1)
      expect(position.liquidity).to.be.eq(6363)

      const poolAddress = await factoryV3.getPool(token.address, wrbtc.address, FeeAmount.MEDIUM)
      if (tokenLower) {
        expect(await token.balanceOf(poolAddress)).to.be.eq(4500)
        expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(4500)
        expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(8999)
      } else {
        expect(await token.balanceOf(poolAddress)).to.be.eq(8999)
        expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(1)
        expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(4500)
      }
    })

    it('half the price - as RBTC', async () => {
      await migrator.createAndInitializePoolIfNecessary(
        token.address,
        wrbtc.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 2)
      )

      const tokenBalanceBefore = await token.balanceOf(wallet.address)

      await pair.approve(migrator.address, expectedLiquidity)
      await expect(
        migrator.migrate({
          pair: pair.address,
          liquidityToMigrate: expectedLiquidity,
          percentageToMigrate: 100,
          token0: tokenLower ? token.address : wrbtc.address,
          token1: tokenLower ? wrbtc.address : token.address,
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(FeeAmount.MEDIUM),
          tickUpper: getMaxTick(FeeAmount.MEDIUM),
          amount0Min: 8999,
          amount1Min: 4500,
          recipient: wallet.address,
          deadline: 1,
          refundAsRBTC: true,
        })
      )
        .to.emit(wrbtc, 'Withdrawal')
        .withArgs(migrator.address, tokenLower ? 4500 : 1)

      const tokenBalanceAfter = await token.balanceOf(wallet.address)

      const position = await nft.positions(1)
      expect(position.liquidity).to.be.eq(6363)

      const poolAddress = await factoryV3.getPool(token.address, wrbtc.address, FeeAmount.MEDIUM)
      if (tokenLower) {
        expect(await token.balanceOf(poolAddress)).to.be.eq(8999)
        expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(1)
        expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(4500)
      } else {
        expect(await token.balanceOf(poolAddress)).to.be.eq(4500)
        expect(tokenBalanceAfter.sub(tokenBalanceBefore)).to.be.eq(4500)
        expect(await wrbtc.balanceOf(poolAddress)).to.be.eq(8999)
      }
    })

    it('gas', async () => {
      await migrator.createAndInitializePoolIfNecessary(
        token.address,
        wrbtc.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await pair.approve(migrator.address, expectedLiquidity)
      await snapshotGasCost(
        migrator.migrate({
          pair: pair.address,
          liquidityToMigrate: expectedLiquidity,
          percentageToMigrate: 100,
          token0: tokenLower ? token.address : wrbtc.address,
          token1: tokenLower ? wrbtc.address : token.address,
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(FeeAmount.MEDIUM),
          tickUpper: getMaxTick(FeeAmount.MEDIUM),
          amount0Min: 9000,
          amount1Min: 9000,
          recipient: wallet.address,
          deadline: 1,
          refundAsRBTC: false,
        })
      )
    })
  })
})
