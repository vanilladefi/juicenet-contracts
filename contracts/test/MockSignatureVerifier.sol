// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC1271Upgradeable.sol";

contract MockSignatureVerifier is IERC1271Upgradeable {
    bool private mockIsValid = true;

    function isValidSignature(bytes32 hash, bytes memory signature)
        external
        view
        returns (bytes4 magicValue)
    {
        if (mockIsValid) {
            return IERC1271Upgradeable.isValidSignature.selector; // valid
        }
        return "abcd"; // invalid
    }

    function setIsValidSignature(bool mockIsValidSign) public {
        mockIsValid = mockIsValidSign;
    }
}
