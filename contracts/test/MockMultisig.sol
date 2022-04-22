pragma solidity ^0.8.0;

import "../interfaces/IMultisig.sol";

contract SimpleForwarder {
    address internal immutable stakingContract;

    constructor(address juice) {
        stakingContract = juice;
    }

    /**
     * @dev Fallback function that just forwards calls to the JuiceStaking contract on behalf of this contract
     */
    fallback() external payable virtual {
        forwardCallTo(stakingContract);
    }

    function forwardCallTo(address target) internal {
        assembly {
            // Copy msg.data.
            calldatacopy(0, 0, calldatasize())

            // Call the implementation.
            let result := call(gas(), target, 0, 0, calldatasize(), 0, 0)

            // Copy the returned data.
            returndatacopy(0, 0, returndatasize())

            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}

contract MockMultisig is IMultisig, SimpleForwarder {
    mapping(address => bool) internal owners;
    address[] internal listOfOwners;

    constructor(address juice) SimpleForwarder(juice) {}

    function setOwners(address[] calldata newOwners) external {
        for (uint256 i = 0; i < listOfOwners.length; i++) {
            delete owners[listOfOwners[i]];
        }
        for (uint256 i = 0; i < newOwners.length; i++) {
            owners[newOwners[i]] = true;
        }
        listOfOwners = newOwners;
    }

    function isOwner(address owner) external view override returns (bool) {
        return owners[owner] == true;
    }
}
