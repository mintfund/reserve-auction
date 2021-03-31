// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.6.8;
pragma experimental ABIEncoderV2;

import {IERC165} from "@openzeppelin/contracts/introspection/IERC165.sol";
import {IMedia} from "./interfaces/IMedia.sol";
import {IMarket} from "./interfaces/IMarket.sol";

interface IReserveAuctionV2Modified {
    function createAuction(
        uint256 tokenId,
        uint256 duration,
        uint256 reservePrice,
        address creator,
        address payable fundsRecipient
    ) external;
}

contract NFTFactoryV2 {
    // ============ Constants ============

    // To check that the given media address represents an ERC721 contract.
    bytes4 internal constant NFT_INTERFACE_ID = 0x80ac58cd;

    // ============ Immutable Storage ============

    // An NFT contract address that represents the media that will eventually be traded.
    address public immutable mediaAddress;

    // ============ Constructor ============

    constructor(address mediaAddress_) public {
        // NFT compatibility check.
        require(
            IERC165(mediaAddress_).supportsInterface(NFT_INTERFACE_ID),
            "Media address must be ERC721"
        );

        // Initialize immutable storage.
        mediaAddress = mediaAddress_;
    }

    function mintNFT(
        IMedia.MediaData calldata mediaData,
        IMarket.BidShares calldata bidShares,
        address payable creator,
        IMedia.EIP712Signature calldata creatorSignature
    ) external {
        IMedia(mediaAddress).mintWithSig(
            creator,
            mediaData,
            bidShares,
            creatorSignature
        );
    }

    function createAuction(
        uint256 tokenId,
        uint256 duration,
        uint256 reservePrice,
        address creator,
        address payable fundsRecipient,
        address auction,
        IMedia.EIP712Signature calldata creatorSignature
    ) external {
        // Allow the auction contract to pull the NFT.
        IMedia(mediaAddress).permit(auction, tokenId, creatorSignature);
        // Create an auction for the NFT, which pulls the NFT.
        IReserveAuctionV2Modified(auction).createAuction(
            tokenId,
            duration,
            reservePrice,
            creator,
            fundsRecipient
        );
    }
}
