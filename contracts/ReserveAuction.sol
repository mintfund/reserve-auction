// // SPDX-License-Identifier: Apache-2.0
// pragma solidity 0.6.8;
// pragma experimental ABIEncoderV2;

// import "@openzeppelin/contracts/math/SafeMath.sol";
// import "@openzeppelin/contracts/access/Ownable.sol";

// import "./interfaces/IMarket.sol";
// import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
// import "@openzeppelin/contracts/introspection/IERC165.sol";
// import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// /**
//    _____                                                   _   _                           
//   |  __ \                                  /\             | | (_)                          
//   | |__) |___ ___  ___ _ ____   _____     /  \  _   _  ___| |_ _  ___  _ __                
//   |  _  // _ / __|/ _ | '__\ \ / / _ \   / /\ \| | | |/ __| __| |/ _ \| '_ \               
//   | | \ |  __\__ |  __| |   \ V |  __/  / ____ | |_| | (__| |_| | (_) | | | |              
//   |_|  \_\___|___/\___|_|    \_/ \___| /_/    \_\__,_|\___|\__|_|\___/|_| |_|              
                                                                                           
                                                                                           
//    ____          ____  _ _ _         _____                       _                         
//   |  _ \        |  _ \(_| | |       |  __ \                     | |                        
//   | |_) |_   _  | |_) |_| | |_   _  | |__) |___ _ __  _ __   ___| | ____ _ _ __ ___  _ __  
//   |  _ <| | | | |  _ <| | | | | | | |  _  // _ | '_ \| '_ \ / _ | |/ / _` | '_ ` _ \| '_ \ 
//   | |_) | |_| | | |_) | | | | |_| | | | \ |  __| | | | | | |  __|   | (_| | | | | | | |_) |
//   |____/ \__, | |____/|_|_|_|\__, | |_|  \_\___|_| |_|_| |_|\___|_|\_\__,_|_| |_| |_| .__/ 
//           __/ |               __/ |                                                 | |    
//          |___/               |___/                                                  |_|    

// */

// contract IMediaModified {
//     mapping(uint256 => address) public tokenCreators;
//     address public marketContract;
// }

// contract ReserveAuction is Ownable, ReentrancyGuard {
//     using SafeMath for uint256;

//     bool public paused;

//     uint256 public timeBuffer = 15 * 60; // extend 15 minutes after every bid made in last 15 minutes
//     uint256 public minBid = 1 * 10**17; // 0.1 eth

//     bytes4 constant interfaceId = 0x80ac58cd; // 721 interface id
//     address public zora = 0xabEFBc9fD2F806065b4f3C237d4b59D9A97Bcac7;

//     mapping(uint256 => Auction) public auctions;
//     uint256[] public tokenIds;

//     struct Auction {
//         bool exists;
//         uint256 amount;
//         uint256 tokenId;
//         uint256 duration;
//         uint256 firstBidTime;
//         uint256 reservePrice;
//         address creator;
//         address payable bidder;
//         address payable creatorShareRecipient;
//     }

//     modifier notPaused() {
//         require(!paused, "Must not be paused");
//         _;
//     }

//     event AuctionCreated(
//         uint256 tokenId,
//         address zoraAddress,
//         uint256 duration,
//         uint256 reservePrice,
//         address creator,
//         address creatorShareRecipient
//     );
//     event AuctionBid(
//         uint256 tokenId,
//         address zoraAddress,
//         address sender,
//         uint256 value,
//         uint256 timestamp,
//         bool firstBid,
//         bool extended
//     );
//     event AuctionEnded(
//         uint256 tokenId,
//         address zoraAddress,
//         address creator,
//         address winner,
//         uint256 amount,
//         address creatorShareRecipient
//     );
//     event AuctionCanceled(
//         uint256 tokenId,
//         address zoraAddress,
//         address creator
//     );

//     constructor(address _zora) public {
//         require(
//             IERC165(_zora).supportsInterface(interfaceId),
//             "Doesn't support NFT interface"
//         );
//         zora = _zora;
//     }

//     function updateZora(address _zora) public onlyOwner {
//         require(
//             IERC165(_zora).supportsInterface(interfaceId),
//             "Doesn't support NFT interface"
//         );
//         zora = _zora;
//     }

//     function updateMinBid(uint256 _minBid) public onlyOwner {
//         minBid = _minBid;
//     }

//     function updateTimeBuffer(uint256 _timeBuffer) public onlyOwner {
//         timeBuffer = _timeBuffer;
//     }

//     function createAuction(
//         uint256 tokenId,
//         uint256 duration,
//         uint256 reservePrice,
//         address creator,
//         address payable creatorShareRecipient
//     ) external notPaused nonReentrant {
//         require(!auctions[tokenId].exists, "Auction already exists");

//         tokenIds.push(tokenId);

//         auctions[tokenId].exists = true;
//         auctions[tokenId].duration = duration;
//         auctions[tokenId].reservePrice = reservePrice;
//         auctions[tokenId].creator = creator;
//         auctions[tokenId].creatorShareRecipient = creatorShareRecipient;

//         IERC721(zora).transferFrom(creator, address(this), tokenId);

//         emit AuctionCreated(
//             tokenId,
//             zora,
//             duration,
//             reservePrice,
//             creator,
//             creatorShareRecipient
//         );
//     }

//     function createBid(uint256 tokenId)
//         external
//         payable
//         notPaused
//         nonReentrant
//     {
//         require(auctions[tokenId].exists, "Auction doesn't exist");
//         require(
//             msg.value >= auctions[tokenId].reservePrice,
//             "Must send reservePrice or more"
//         );
//         require(
//             auctions[tokenId].firstBidTime == 0 ||
//                 block.timestamp <
//                 auctions[tokenId].firstBidTime + auctions[tokenId].duration,
//             "Auction expired"
//         );

//         uint256 lastValue = auctions[tokenId].amount;

//         bool firstBid = false;
//         address payable lastBidder = address(0);

//         // allows for auctions with starting price of 0
//         if (lastValue != 0) {
//             require(msg.value > lastValue, "Must send more than last bid");
//             require(
//                 msg.value.sub(lastValue) >= minBid,
//                 "Must send more than last bid by minBid Amount"
//             );
//             lastBidder = auctions[tokenId].bidder;
//         } else {
//             firstBid = true;
//             auctions[tokenId].firstBidTime = block.timestamp;
//         }

//         require(
//             IMarket(IMediaModified(zora).marketContract()).isValidBid(
//                 tokenId,
//                 msg.value
//             ),
//             "Market: Ask invalid for share splitting"
//         );

//         auctions[tokenId].amount = msg.value;
//         auctions[tokenId].bidder = msg.sender;

//         bool extended = false;
//         // at this point we know that the timestamp is less than start + duration
//         // we want to know by how much the timestamp is less than start + duration
//         // if the difference is less than the timeBuffer, increase the duration by the timeBuffer
//         if (
//             (auctions[tokenId].firstBidTime.add(auctions[tokenId].duration))
//                 .sub(block.timestamp) < timeBuffer
//         ) {
//             auctions[tokenId].duration += timeBuffer;
//             extended = true;
//         }

//         emit AuctionBid(
//             tokenId,
//             zora,
//             msg.sender,
//             msg.value,
//             block.timestamp,
//             firstBid,
//             extended
//         );

//         if (!firstBid) {
//             lastBidder.transfer(lastValue);
//         }
//     }

//     function endAuction(uint256 tokenId) external notPaused nonReentrant {
//         require(auctions[tokenId].exists, "Auction doesn't exist");
//         require(
//             uint256(auctions[tokenId].firstBidTime) != 0,
//             "Auction hasn't begun"
//         );
//         require(
//             block.timestamp >=
//                 auctions[tokenId].firstBidTime + auctions[tokenId].duration,
//             "Auction hasn't completed"
//         );

//         address winner = auctions[tokenId].bidder;
//         uint256 amount = auctions[tokenId].amount;
//         address creator = auctions[tokenId].creator;
//         address payable creatorShareRecipient =
//             auctions[tokenId].creatorShareRecipient;

//         emit AuctionEnded(
//             tokenId,
//             zora,
//             creator,
//             winner,
//             amount,
//             creatorShareRecipient
//         );
//         delete auctions[tokenId];

//         IERC721(zora).transferFrom(address(this), winner, tokenId);

//         IMarket.BidShares memory bidShares =
//             IMarket(IMediaModified(zora).marketContract()).bidSharesForToken(
//                 tokenId
//             );

//         // solc 6.0 method for casting payable addresses:
//         address payable originalCreator =
//             payable(address(IMediaModified(zora).tokenCreators(tokenId)));

//         uint256 creatorAmount =
//             IMarket(IMediaModified(zora).marketContract()).splitShare(
//                 bidShares.creator,
//                 amount
//             );

//         uint256 sellerAmount = amount.sub(creatorAmount);

//         originalCreator.transfer(creatorAmount);
//         creatorShareRecipient.transfer(sellerAmount);
//     }

//     function cancelAuction(uint256 tokenId) external nonReentrant {
//         require(auctions[tokenId].exists, "Auction doesn't exist");
//         require(
//             auctions[tokenId].creator == msg.sender || msg.sender == owner(),
//             "Can only be called by auction creator or owner"
//         );
//         require(
//             uint256(auctions[tokenId].firstBidTime) == 0,
//             "Can't cancel an auction once it's begun"
//         );
//         address creator = auctions[tokenId].creator;
//         delete auctions[tokenId];
//         IERC721(zora).transferFrom(address(this), creator, tokenId);
//         emit AuctionCanceled(tokenId, zora, creator);
//     }

//     function updatePaused(bool _paused) public onlyOwner {
//         paused = _paused;
//     }
// }
