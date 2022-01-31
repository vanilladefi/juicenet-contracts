// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;


import { StakingParam } from "./interfaces/IJuiceStakerActions.sol";
import { Permission } from "./interfaces/IJuiceStakerDelegateActions.sol";

abstract contract JuiceStakerDelegateEIP712Util {
    /// @notice as defined in EIP-712
    string constant private EIP712DOMAIN_SIG = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

    string constant private PERMISSION_SIG = "Permission(address sender,uint deadline,uint nonce)";
    string constant private DEPOSIT_SIG = "Deposit(uint amount,Permission permission)";
    string constant private WITHDRAW_SIG = "Withdraw(uint amount,Permission permission)";
    string constant private STAKE_SIG = "Stake(address token,uint128 amount,bool sentiment)";
    string constant private MODIFY_STAKES_SIG = "ModifyStakes(Stake[] stakes,Permission permission)";
    bytes32 constant private STAKE_SIGHASH = keccak256(bytes(STAKE_SIG));

    /// @notice Contains the latest permission nonces for each Staker, for replay attack protection.
    mapping (address => uint) internal permissionNonces;

    /// @dev The standard EIP-712 domain separator.
    function hashDomainSeparator(string memory name, string memory version, uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(bytes(EIP712DOMAIN_SIG)),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifyingContract
            )
        );
    }

    function hashPermission(Permission calldata permission) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(bytes(PERMISSION_SIG)),
                permission.sender,
                permission.deadline,
                permission.nonce
            )
        );
    }

    function hashDeposit(uint amount, Permission calldata permission) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(abi.encodePacked(DEPOSIT_SIG, PERMISSION_SIG)),
                amount,
                hashPermission(permission)
            )
        );
    }

    function hashWithdraw(uint amount, Permission calldata permission) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(abi.encodePacked(WITHDRAW_SIG, PERMISSION_SIG)),
                amount,
                hashPermission(permission)
            )
        );
    }

    /// @dev uses precomputed STAKE_SIGHASH because this function is called in a loop from `hashModifyStakes`
    function hashStake(StakingParam calldata param) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                STAKE_SIGHASH,
                param.token,
                param.amount,
                param.sentiment
            )
        );
    }

    function hashModifyStakes(StakingParam[] calldata params, Permission calldata permission) public pure returns (bytes32) {
        // no array.map in Solidity so intermediate memory array is needed for transforming params into struct hashes
        bytes32[] memory stakeHashes = new bytes32[](params.length);
        for (uint i = 0; i < params.length; i++) {
            stakeHashes[i] = hashStake(params[i]);
        }

        return keccak256(
            abi.encode(
            // the order of signatures matters, after the main struct are all the nested structs in alphabetical order (as stated in EIP-712)
                keccak256(abi.encodePacked(MODIFY_STAKES_SIG, PERMISSION_SIG, STAKE_SIG)),
            // array arguments are simply concatenated, so use encodePacked instead of encode
                keccak256(abi.encodePacked(stakeHashes)),
                hashPermission(permission)
            )
        );
    }

}

