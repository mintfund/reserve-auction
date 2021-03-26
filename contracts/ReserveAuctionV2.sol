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

contract IMediaModified {
    mapping(uint256 => address) public tokenCreators;
    address public marketContract;
}

contract ReserveAuctionV2 is Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    uint256 public timeBuffer = 15 * 60; // extend 15 minutes after every bid made in last 15 minutes
    uint256 public minBid = 1 * 10**16; // 0.01 ETH

    address public NftContract;

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
        address NftContractAddress,
        uint256 duration,
        uint256 reservePrice,
        address creator,
        address fundsRecipient
    );

    event AuctionBid(
        uint256 indexed tokenId,
        address NftContractAddress,
        address sender,
        uint256 value,
        uint256 timestamp,
        bool firstBid,
        bool extended
    );

    constructor(address _NftContract) public {
        require(
            IERC165(_NftContract).supportsInterface(interfaceId),
            "Doesn't support NFT interface"
        );
        NftContract = _NftContract;
    }

    function updateNftContract(address _NftContract) external onlyOwner {
        require(
            IERC165(_NftContract).supportsInterface(interfaceId),
            "Doesn't support NFT interface"
        );
        NftContract = _NftContract;
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

        IERC721(NftContract).transferFrom(creator, address(this), tokenId);

        emit AuctionCreated(
            tokenId,
            NftContract,
            duration,
            reservePrice,
            creator,
            fundsRecipient
        );
    }

    function createBid(uint256 tokenId, uint256 amount)
        external
        payable
        nonReentrant
    {
        require(amount == msg.value, "Amount doesn't equal msg.value");
        require(auctions[tokenId].exists, "Auction doesn't exist");
        require(
            amount >= auctions[tokenId].reservePrice,
            "Must bid reservePrice or more"
        );
        require(
            auctions[tokenId].firstBidTime == 0 ||
                block.timestamp <
                auctions[tokenId].firstBidTime + auctions[tokenId].duration,
            "Auction expired"
        );

        uint256 lastValue = auctions[tokenId].amount;

        bool firstBid = false;
        address payable lastBidder = address(0);

        if (lastValue != 0) {
            require(amount > lastValue, "Must send more than last bid");
            require(
                amount.sub(lastValue) > minBid,
                "Must send more than last bid by minBid amount"
            );
            lastBidder = auctions[tokenId].bidder;
        } else {
            firstBid = true;
            auctions[tokenId].firstBidTime = block.timestamp;
        }

        require(
            IMarket(IMediaModified(NftContract).marketContract()).isValidBid(
                tokenId,
                amount
            ),
            "Market: ask invalid for share splitting"
        );

        auctions[tokenId].amount = amount;
        auctions[tokenId].bidder = msg.sender;

        bool extended = false;
        // at this point we know that the timestamp is less than start + duration
        // we want to know by how much the timestamp is less than start + duration
        // if the difference is less than the timeBuffer, increase the duration by the timeBuffer
        if (
            auctions[tokenId].firstBidTime.add(auctions[tokenId].duration).sub(
                block.timestamp
            ) < timeBuffer
        ) {
            auctions[tokenId].duration += timeBuffer;
            extended = true;
        }

        emit AuctionBid(
            tokenId,
            NftContract,
            msg.sender,
            amount,
            block.timestamp,
            firstBid,
            extended
        );

        if (!firstBid) {
            lastBidder.transfer(amount);
        }
    }
}
