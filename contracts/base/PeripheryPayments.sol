// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.5;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

import '../interfaces/IPeripheryPayments.sol';
import '../interfaces/external/IWRBTC.sol';

import '../libraries/TransferHelper.sol';

import './PeripheryImmutableState.sol';

abstract contract PeripheryPayments is IPeripheryPayments, PeripheryImmutableState {
    receive() external payable {
        require(msg.sender == WRBTC, 'Not WRBTC');
    }

    /// @inheritdoc IPeripheryPayments
    function unwrapWRBTC(uint256 amountMinimum, address recipient) external payable override {
        uint256 balanceWRBTC = IWRBTC(WRBTC).balanceOf(address(this));
        require(balanceWRBTC >= amountMinimum, 'Insufficient WRBTC');

        if (balanceWRBTC > 0) {
            IWRBTC(WRBTC).withdraw(balanceWRBTC);
            TransferHelper.safeTransferRBTC(recipient, balanceWRBTC);
        }
    }

    /// @inheritdoc IPeripheryPayments
    function sweepToken(
        address token,
        uint256 amountMinimum,
        address recipient
    ) external payable override {
        uint256 balanceToken = IERC20(token).balanceOf(address(this));
        require(balanceToken >= amountMinimum, 'Insufficient token');

        if (balanceToken > 0) {
            TransferHelper.safeTransfer(token, recipient, balanceToken);
        }
    }

    /// @inheritdoc IPeripheryPayments
    function refundRBTC() external payable override {
        if (address(this).balance > 0) TransferHelper.safeTransferRBTC(msg.sender, address(this).balance);
    }

    /// @param token The token to pay
    /// @param payer The entity that must pay
    /// @param recipient The entity that will receive payment
    /// @param value The amount to pay
    function pay(
        address token,
        address payer,
        address recipient,
        uint256 value
    ) internal {
        if (token == WRBTC && address(this).balance >= value) {
            // pay with WRBTC
            IWRBTC(WRBTC).deposit{value: value}(); // wrap only what is needed to pay
            IWRBTC(WRBTC).transfer(recipient, value);
        } else if (payer == address(this)) {
            // pay with tokens already in the contract (for the exact input multihop case)
            TransferHelper.safeTransfer(token, recipient, value);
        } else {
            // pull payment
            TransferHelper.safeTransferFrom(token, payer, recipient, value);
        }
    }
}
