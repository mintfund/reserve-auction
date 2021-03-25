// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.6.8;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IMarket} from "./interfaces/IMarket.sol";
import {IERC165} from "@openzeppelin/contracts/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ReserveAuctionV2 is Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    address public zora;

    bytes4 constant interfaceId = 0x80ac58cd; // 721 interface id

    constructor(address _zora) public {
        require(
            IERC165(_zora).supportsInterface(interfaceId),
            "Doesn't support NFT interface"
        );
        zora = _zora;
    }

    function updateZora(address _zora) external onlyOwner {
        require(
            IERC165(_zora).supportsInterface(interfaceId),
            "Doesn't support NFT interface"
        );
        zora = _zora;
    }
}
