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

    uint256 public timeBuffer = 15 * 60; // extend 15 minutes after every bid made in last 15 minutes
    uint256 public minBid = 1 * 10**16; // 0.01 ETH

    address public zora;

    bytes4 constant interfaceId = 0x80ac58cd; // 721 interface id

    mapping(uint256 => Auction) public auctions;

    struct Auction {
        bool exists;
        uint256 amount;
        uint256 duration;
        uint256 firstBidTime;
        uint256 reservePrice;
        address creator;
        address payable bidder;
        address payable fundsRecipient;
    }

    event AuctionCreated(
        uint256 indexed tokenId,
        address zoraAddress,
        uint256 duration,
        uint256 reservePrice,
        address creator,
        address fundsRecipient
    );

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

    function updateMinBid(uint256 _minBid) external onlyOwner {
        minBid = _minBid;
    }

    function updateTimeBuffer(uint256 _timeBuffer) external onlyOwner {
        timeBuffer = _timeBuffer;
    }

    function createAuction(
        uint256 tokenId,
        uint256 duration,
        uint256 reservePrice,
        address creator,
        address payable fundsRecipient
    ) external nonReentrant {
        require(!auctions[tokenId].exists, "Auction already exists");

        auctions[tokenId].exists = true;
        auctions[tokenId].duration = duration;
        auctions[tokenId].reservePrice = reservePrice;
        auctions[tokenId].creator = creator;
        auctions[tokenId].fundsRecipient = fundsRecipient;

        emit AuctionCreated(
            tokenId,
            zora,
            duration,
            reservePrice,
            creator,
            fundsRecipient
        );
    }
}
