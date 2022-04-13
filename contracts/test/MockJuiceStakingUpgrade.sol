// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "../JuiceStaking02.sol";

contract MockJuiceStakingUpgrade is JuiceStaking02 {
    uint256 public addedField;

    function initializeOnUpgrade(uint256 fieldValue) external onlyOwner {
        addedField = fieldValue;
    }
}

contract MockBadJuiceStakingUpgrade is UUPSUpgradeable {
    uint256 public addedField;

    function initializeOnUpgrade(uint256 fieldValue) external {
        addedField = fieldValue;
    }

    function _authorizeUpgrade(address newImplementation) internal override {}
}

contract MockNonUUPSJuiceStakingUpgrade {
    uint256 public addedField;

    function initializeOnUpgrade(uint256 fieldValue) external {
        addedField = fieldValue;
    }
}
