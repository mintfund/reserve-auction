// SPDX-License-Identifier: GPL-3.0-or-later
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

interface IWETH {
    function deposit() external payable;

    function transfer(address to, uint256 value) external returns (bool);
}

contract ReserveAuctionV2 is Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    //======= Constants =======

    bytes4 private constant ERC721_INTERFACE_ID = 0x80ac58cd;
    // 15 min
    uint16 public constant TIME_BUFFER = 900;
    // 0.001 ETH
    uint64 public constant MIN_BID = 1e15;

    //======= Immutable Storage =======

    address public nftContract;
    address public immutable wethAddress;

    //======= Mutable Storage =======

    mapping(uint256 => Auction) public auctions;

    //======= Structs =======
    struct Auction {
        uint256 amount;
        uint256 duration;
        uint256 firstBidTime;
        uint256 reservePrice;
        address creator;
        address payable bidder;
        address payable fundsRecipient;
    }

    //======= Events =======
    event AuctionCreated(
        uint256 indexed tokenId,
        address nftContractAddress,
        uint256 duration,
        uint256 reservePrice,
        address creator,
        address fundsRecipient
    );

    event AuctionBid(
        uint256 indexed tokenId,
        address nftContractAddress,
        address sender,
        uint256 value
    );

    event AuctionCanceled(
        uint256 indexed tokenId,
        address nftContractAddress,
        address creator
    );

    event AuctionEnded(
        uint256 indexed tokenId,
        address nftContractAddress,
        address creator,
        address winner,
        uint256 amount,
        address originalCreator,
        address payable fundsRecipient
    );

    //======= Modifiers =======

    // Reverts if the auction does not exist.
    modifier auctionExists(uint256 tokenId) {
        // The auction exists if the creator is not null.
        require(!auctionCreatorIsNull(tokenId), "Auction doesn't exist");
        _;
    }

    // Reverts if the auction exists.
    modifier auctionNonExistant(uint256 tokenId) {
        // The auction does not exist if the creator is null.
        require(auctionCreatorIsNull(tokenId), "Auction already exists");
        _;
    }

    // Reverts if the auction is expired.
    modifier auctionNotExpired(uint256 tokenId) {
        require(
            auctions[tokenId].firstBidTime == 0 ||
                block.timestamp <
                auctions[tokenId].firstBidTime + auctions[tokenId].duration,
            "Auction expired"
        );
        _;
    }

    // Reverts if the sender is not the auction's creator.
    modifier onlyCreator(uint256 tokenId) {
        require(
            auctions[tokenId].creator == msg.sender,
            "Can only be called by auction creator"
        );
        _;
    }

    //======= Constructor =======

    constructor(address nftContract_, address wethAddress_) public {
        require(
            IERC165(nftContract_).supportsInterface(ERC721_INTERFACE_ID),
            "Doesn't support NFT interface"
        );
        nftContract = nftContract_;
        wethAddress = wethAddress_;
    }

    //======= External Functions =======

    function createAuction(
        uint256 tokenId,
        uint256 duration,
        uint256 reservePrice,
        address creator,
        address payable fundsRecipient
    ) external nonReentrant auctionNonExistant(tokenId) {
        require(creator != address(0));
        require(fundsRecipient != address(0));

        auctions[tokenId] = Auction({
            duration: duration,
            reservePrice: reservePrice,
            creator: creator,
            fundsRecipient: fundsRecipient,
            amount: 0,
            firstBidTime: 0,
            bidder: address(0)
        });

        IERC721(nftContract).transferFrom(creator, address(this), tokenId);

        emit AuctionCreated(
            tokenId,
            nftContract,
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
        auctionExists(tokenId)
        auctionNotExpired(tokenId)
    {
        require(amount == msg.value, "Amount doesn't equal msg.value");

        // Check if the current bid amount is 0.
        if (auctions[tokenId].amount == 0) {
            // If so, it is the first bid.
            auctions[tokenId].firstBidTime = block.timestamp;
            // We only need to check if the bid matches reserve bid for the first bid,
            // since future checks will need to be higher than any previous bid.
            require(
                amount >= auctions[tokenId].reservePrice,
                "Must bid reservePrice or more"
            );
        } else {
            // Check that the new bid is sufficiently higher than the previous bid.
            require(
                amount.sub(auctions[tokenId].amount) > MIN_BID,
                "Must send more than last bid by MIN_BID amount"
            );

            // Refund the previous bidder.
            transferETHOrWETH(
                auctions[tokenId].bidder,
                auctions[tokenId].amount
            );
        }

        // Confirm that this is a valid bid, according to Zora market.
        require(
            IMarket(IMediaModified(nftContract).marketContract()).isValidBid(
                tokenId,
                amount
            ),
            "Market: ask invalid for share splitting"
        );

        // Update the current auction.
        auctions[tokenId].amount = amount;
        auctions[tokenId].bidder = msg.sender;

        if (
            auctions[tokenId].firstBidTime.add(auctions[tokenId].duration).sub(
                block.timestamp
            ) < TIME_BUFFER
        ) {
            auctions[tokenId].duration += TIME_BUFFER;
        }

        emit AuctionBid(tokenId, nftContract, msg.sender, amount);
    }

    function endAuction(uint256 tokenId)
        external
        nonReentrant
        auctionExists(tokenId)
    {
        require(
            uint256(auctions[tokenId].firstBidTime) != 0,
            "Auction hasn't begun"
        );
        require(
            block.timestamp >=
                auctions[tokenId].firstBidTime + auctions[tokenId].duration,
            "Auction hasn't completed"
        );

        address winner = auctions[tokenId].bidder;
        uint256 amount = auctions[tokenId].amount;
        address creator = auctions[tokenId].creator;
        address payable fundsRecipient = auctions[tokenId].fundsRecipient;

        delete auctions[tokenId];

        IERC721(nftContract).transferFrom(address(this), winner, tokenId);

        IMarket.BidShares memory bidShares =
            IMarket(IMediaModified(nftContract).marketContract())
                .bidSharesForToken(tokenId);

        address payable originalCreator =
            payable(
                address(IMediaModified(nftContract).tokenCreators(tokenId))
            );
        uint256 creatorAmount =
            IMarket(IMediaModified(nftContract).marketContract()).splitShare(
                bidShares.creator,
                amount
            );

        transferETHOrWETH(originalCreator, creatorAmount);
        // Send the remainder of the amount to the funds recipient.
        transferETHOrWETH(fundsRecipient, amount.sub(creatorAmount));

        emit AuctionEnded(
            tokenId,
            nftContract,
            creator,
            winner,
            amount,
            originalCreator,
            fundsRecipient
        );
    }

    function cancelAuction(uint256 tokenId)
        external
        nonReentrant
        auctionExists(tokenId)
        onlyCreator(tokenId)
    {
        require(
            uint256(auctions[tokenId].firstBidTime) == 0,
            "Auction already started"
        );
        address creator = auctions[tokenId].creator;
        delete auctions[tokenId];
        IERC721(nftContract).transferFrom(address(this), creator, tokenId);
        emit AuctionCanceled(tokenId, nftContract, creator);
    }

    //======= Internal Functions =======

    function transferETHOrWETH(address to, uint256 value) internal {
        // Try to transfer ETH to the given recipient.
        if (!safeTransferETH(to, value)) {
            // If the transfer fails, wrap and send as WETH, so that
            // the auction is not impeded.
            IWETH(wethAddress).deposit{value: value}();
            IWETH(wethAddress).transfer(to, value);
        }
    }

    function safeTransferETH(address to, uint256 value)
        internal
        returns (bool)
    {
        (bool success, ) = to.call{value: value}(new bytes(0));
        return success;
    }

    function auctionCreatorIsNull(uint256 tokenId)
        internal
        view
        returns (bool)
    {
        // The auction does not exist if the creator is the null address,
        // since the NFT would not have been transferred.
        return auctions[tokenId].creator == address(0);
    }
}
