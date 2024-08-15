# Intrinsic Periphery

This repository contains the periphery smart contracts for the Intrinsic Protocol.
For the lower level core contracts, see the [intrinsic-core](https://github.com/Intrinsic-network/core)
repository.

## Bug bounty

This repository is subject to the Intrinsic bug bounty program,
per the terms defined [here](./bug-bounty.md).

## Local deployment

In order to deploy this code to a local testnet, you should install the npm package
`@intrinsic-finance/periphery`
and import bytecode imported from artifacts located at
`@intrinsic-finance/periphery/artifacts/contracts/*/*.json`.
For example:

```typescript
import {
  abi as SWAP_ROUTER_ABI,
  bytecode as SWAP_ROUTER_BYTECODE,
} from '@intrinsic-finance/periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'

// deploy the bytecode
```

This will ensure that you are testing against the same bytecode that is deployed to
mainnet and public testnets, and all Intrinsic code will correctly interoperate with
your local deployment.

## Using solidity interfaces

The Intrinsic periphery interfaces are available for import into solidity smart contracts
via the npm artifact `@intrinsic-finance/periphery`, e.g.:

```solidity
import '@intrinsic-finance/periphery/contracts/interfaces/ISwapRouter.sol';

contract MyContract {
  ISwapRouter router;

  function doSomethingWithSwapRouter() {
    // router.exactInput(...);
  }
}

```
