// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {ILido, ILidoLocator, IWithdrawalQueue} from "../sanity_checks/AccountingOracleReportSanityChecks.sol";

contract LidoLocatorMock is ILidoLocator {
    address private immutable LIDO;
    address private immutable WITHDRAWAL_VAULT;
    address private immutable WITHDRAWAL_QUEUE;

    constructor(address _lido, address _withdrawalVault, address _withdrawalQueue) {
        LIDO = _lido;
        WITHDRAWAL_VAULT = _withdrawalVault;
        WITHDRAWAL_QUEUE = _withdrawalQueue;
    }

    function getLido() external view returns (address) {
        return LIDO;
    }

    function getWithdrawalQueue() external view returns (address) {
        return WITHDRAWAL_QUEUE;
    }

    function getWithdrawalVault() external view returns (address) {
        return WITHDRAWAL_VAULT;
    }
}

contract WithdrawalQueueMockForAccountingOracleSanityChecks {
    mapping(uint256 => uint256) private _blockNumbers;

    function setBlockNumber(uint256 _requestId, uint256 _blockNumber) external {
        _blockNumbers[_requestId] = _blockNumber;
    }

    function getWithdrawalRequestStatus(uint256 _requestId)
        external
        view
        returns (
            uint256,
            uint256,
            address,
            uint256 blockNumber,
            bool,
            bool
        )
    {
        blockNumber = _blockNumbers[_requestId];
    }
}

contract LidoMockForAccountingOracleSanityChecks {
    uint256 private _shareRate = 1 ether;

    function getSharesByPooledEth(uint256 _sharesAmount) external view returns (uint256) {
        return (_shareRate * _sharesAmount) / 1 ether;
    }

    function setShareRate(uint256 _value) external {
        _shareRate = _value;
    }
}
