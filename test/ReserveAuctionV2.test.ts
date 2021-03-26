import chai, { expect } from 'chai';
import asPromised from 'chai-as-promised';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Blockchain } from '../utils/Blockchain';
import {
  MarketFactory,
  MediaFactory,
  ReserveAuctionV2,
  ReserveAuctionV2Factory,
  Media,
} from '../typechain';
import Decimal from '../utils/Decimal';
import { generatedWallets } from '../utils/generatedWallets';
import { Wallet } from '@ethersproject/wallet';
import { BigNumber, Bytes, ContractTransaction, ethers } from 'ethers';
import { sha256 } from 'ethers/lib/utils';
import { signPermit } from './utils';

chai.use(asPromised);

const provider = new JsonRpcProvider();
const blockchain = new Blockchain(provider);

const ERROR_MESSAGES = {
  NOT_NFT: "Doesn't support NFT interface",
  NOT_OWNER: 'Ownable: caller is not the owner',
  AUCTION_ALREADY_EXISTS: 'Auction already exists',
  AUCTION_DOESNT_EXIST: "Auction doesn't exist",
  INVALID_AMOUNT: "Amount doesn't equal msg.value",
  AUCTION_EXPIRED: 'Auction expired',
  BID_TOO_LOW: 'Must send more than last bid',
  NOT_MIN_BID: 'Must send more than last bid by minBid amount',
};

let contentHex: string;
let contentHash: string;
let contentHashBytes: Bytes;
let otherContentHex: string;
let otherContentHash: string;
let metadataHex: string;
let metadataHash: string;
let metadataHashBytes: Bytes;

let marketAddress: string;
let mediaAddress: string;
let auctionAddress: string;

let tokenURI = 'www.example.com';
let metadataURI = 'www.example2.com';

let defaultBidShares = {
  prevOwner: Decimal.new(10),
  owner: Decimal.new(80),
  creator: Decimal.new(10),
};

type DecimalValue = { value: BigNumber };

type BidShares = {
  owner: DecimalValue;
  prevOwner: DecimalValue;
  creator: DecimalValue;
};

type MediaData = {
  tokenURI: string;
  metadataURI: string;
  contentHash: Bytes;
  metadataHash: Bytes;
};

const [
  deployerWallet,
  creatorWallet,
  fundsRecipientWallet,
  firstBidderWallet,
  secondBidderWallet,
  otherWallet,
] = generatedWallets(provider);

function twoETH(): BigNumber {
  return BigNumber.from(10).mul(18).mul(2);
}

function oneETH(): BigNumber {
  return BigNumber.from(10).mul(18);
}

function halfETH(): BigNumber {
  return BigNumber.from(10).mul(18).div(0.5);
}

async function deploy() {
  const market = await (
    await new MarketFactory(deployerWallet).deploy()
  ).deployed();

  marketAddress = market.address;

  const media = await (
    await new MediaFactory(deployerWallet).deploy(marketAddress)
  ).deployed();

  mediaAddress = media.address;

  await market.configure(mediaAddress);

  const auction = await (
    await new ReserveAuctionV2Factory(deployerWallet).deploy(mediaAddress)
  ).deployed();

  auctionAddress = auction.address;
}

async function mediaAs(wallet: Wallet) {
  return MediaFactory.connect(mediaAddress, wallet);
}

async function mint(
  zoraMedia: Media,
  metadataURI: string,
  tokenURI: string,
  contentHash: Bytes,
  metadataHash: Bytes,
  shares: BidShares
) {
  const data: MediaData = {
    tokenURI,
    metadataURI,
    contentHash,
    metadataHash,
  };

  return zoraMedia.mint(data, shares);
}

async function mintTokenAs(wallet: Wallet) {
  const zoraMediaAsCreator = await mediaAs(wallet);

  await mint(
    zoraMediaAsCreator,
    metadataURI,
    tokenURI,
    contentHashBytes,
    metadataHashBytes,
    defaultBidShares
  );

  const totalTokens = await zoraMediaAsCreator.balanceOf(creatorWallet.address);

  const lastToken = await zoraMediaAsCreator.tokenOfOwnerByIndex(
    creatorWallet.address,
    totalTokens.sub(1)
  );

  return lastToken;
}

async function auctionAs(wallet: Wallet): Promise<ReserveAuctionV2> {
  return ReserveAuctionV2Factory.connect(auctionAddress, wallet);
}

interface IAuctionData {
  tokenId: number;
  reservePrice: BigNumber;
  duration: number;
}

async function setupAuctionData(): Promise<IAuctionData> {
  const token = await mintTokenAs(creatorWallet);

  const tokenId = token.toNumber();
  const duration = 60 * 60 * 24; // 24 hours
  const reservePrice = oneETH();

  return {
    tokenId,
    duration,
    reservePrice,
  };
}

async function setupAuction({
  tokenId,
  reservePrice,
  duration,
}: IAuctionData): Promise<ContractTransaction> {
  const chainId = 1;
  const auctionAsCreator = await auctionAs(creatorWallet);
  const nftContractAsCreator = await mediaAs(creatorWallet);

  const sig = await signPermit(
    creatorWallet,
    auctionAddress,
    mediaAddress,
    tokenId,
    chainId
  );

  await nftContractAsCreator.permit(auctionAddress, tokenId, sig);

  return auctionAsCreator.createAuction(
    tokenId,
    duration,
    reservePrice,
    creatorWallet.address,
    fundsRecipientWallet.address
  );
}

describe('ReserveAuctionV2', () => {
  beforeEach(async () => {
    await blockchain.resetAsync();

    metadataHex = ethers.utils.formatBytes32String('{}');
    metadataHash = await sha256(metadataHex);
    metadataHashBytes = ethers.utils.arrayify(metadataHash);

    contentHex = ethers.utils.formatBytes32String('invert');
    contentHash = await sha256(contentHex);
    contentHashBytes = ethers.utils.arrayify(contentHash);

    otherContentHex = ethers.utils.formatBytes32String('otherthing');
    otherContentHash = await sha256(otherContentHex);
  });

  before(async () => {
    await deploy();
  });

  describe('#constructor', () => {
    describe('when the passed in address does not meet the NFT standard', () => {
      it.skip('should revert', async () => {
        await expect(
          new ReserveAuctionV2Factory(deployerWallet).deploy(marketAddress)
        ).rejectedWith(ERROR_MESSAGES.NOT_NFT);
      });
    });

    describe('happy path', () => {
      describe('when the passed in address does meet the NFT standard', () => {
        it('should set the NftContract address', async () => {
          const auction = await auctionAs(deployerWallet);
          expect(await auction.NftContract()).eq(mediaAddress);
        });
      });
    });
  });

  describe('#updateNftContract', () => {
    describe('sad path', () => {
      describe('when a non-owner tries to call the function', () => {
        it('should revert', async () => {
          const auction = await auctionAs(otherWallet);
          await expect(auction.updateNftContract(mediaAddress)).rejectedWith(
            ERROR_MESSAGES.NOT_OWNER
          );
        });
      });
    });

    describe('happy path', () => {
      describe('when the passed in address does meet the NFT standard', () => {
        it('should set the NftContract address', async () => {
          const auction = await auctionAs(deployerWallet);

          expect(await auction.NftContract()).eq(mediaAddress);

          const newMediaContract = await (
            await new MediaFactory(deployerWallet).deploy(marketAddress)
          ).deployed();

          await auction.updateNftContract(newMediaContract.address);

          expect(await auction.NftContract()).eq(newMediaContract.address);
        });
      });
    });

    // Reset NftContract address so other tests don't break
    after(async () => {
      const auction = await auctionAs(deployerWallet);
      await auction.updateNftContract(mediaAddress);
    });
  });

  describe('#updateMinBid', () => {
    describe('sad path', () => {
      describe('when a non-owner tries to call the function', () => {
        it('should revert', async () => {
          const auction = await auctionAs(otherWallet);

          const newMinBid = BigNumber.from(10).pow(17); // 0.1 ETH

          await expect(auction.updateMinBid(newMinBid)).rejectedWith(
            ERROR_MESSAGES.NOT_OWNER
          );
        });
      });
    });

    describe('happy path', () => {
      describe('when called by the owner', () => {
        it('should update the min bid', async () => {
          const auction = await auctionAs(deployerWallet);

          const defaultMinBid = BigNumber.from(10).pow(16); // 0.01 ETH

          expect((await auction.minBid()).toString()).eq(
            defaultMinBid.toString()
          );

          const newMinBid = BigNumber.from(10).pow(17); // 0.1 ETH

          await auction.updateMinBid(newMinBid);

          expect((await auction.minBid()).toString()).eq(newMinBid.toString());
        });
      });
    });
  });

  describe('#updateTimeBuffer', () => {
    describe('sad path', () => {
      describe('when a non-owner tries to call the function', () => {
        it('should revert', async () => {
          const auction = await auctionAs(otherWallet);

          const newTimeBuffer = 1;

          await expect(auction.updateTimeBuffer(newTimeBuffer)).rejectedWith(
            ERROR_MESSAGES.NOT_OWNER
          );
        });
      });
    });

    describe('happy path', () => {
      describe('when called by the owner', () => {
        it('should update the min bid', async () => {
          const auction = await auctionAs(deployerWallet);

          const defaultTimeBuffer = 60 * 15; // 15 minutes

          expect(await (await auction.timeBuffer()).toNumber()).eq(
            defaultTimeBuffer
          );

          const newTimeBuffer = 60 + 5; // 5 minutes

          await auction.updateTimeBuffer(newTimeBuffer);

          expect(await (await auction.timeBuffer()).toNumber()).eq(
            newTimeBuffer
          );
        });
      });
    });
  });

  describe('#createAuction', () => {
    beforeEach(async () => {
      await deploy();
    });

    describe('sad path', () => {
      describe('when the auction already exists', () => {
        it('should revert', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await (
            await setupAuction({
              tokenId,
              duration,
              reservePrice,
            })
          ).wait();

          const auctionAsCreator = await auctionAs(creatorWallet);

          await expect(
            auctionAsCreator.createAuction(
              tokenId,
              duration,
              reservePrice,
              creatorWallet.address,
              fundsRecipientWallet.address
            )
          ).rejectedWith(ERROR_MESSAGES.AUCTION_ALREADY_EXISTS);
        });
      });
    });

    describe('happy path', () => {
      describe('when an auction is created', () => {
        it('should set the attributes correctly', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsCreator = await auctionAs(creatorWallet);
          const auction = await auctionAsCreator.auctions(tokenId);

          expect(auction.exists).eq(true);
          expect(auction.reservePrice.toString()).eq(reservePrice.toString());
          expect(auction.duration.toNumber()).eq(duration);
          expect(auction.creator).eq(creatorWallet.address);
          expect(auction.fundsRecipient).eq(fundsRecipientWallet.address);
        });

        it('should transfer the NFT to the auction', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          const nftContractAsCreator = await mediaAs(creatorWallet);

          const nftOwnerBeforeCreateAuction = await nftContractAsCreator.ownerOf(
            tokenId
          );

          expect(nftOwnerBeforeCreateAuction).eq(creatorWallet.address);

          await setupAuction({
            tokenId,
            duration,
            reservePrice,
          });

          const nftOwnerAfterCreateAuction = await nftContractAsCreator.ownerOf(
            tokenId
          );

          expect(nftOwnerAfterCreateAuction).eq(auctionAddress);
        });

        it('should emit the AuctionCreated event', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          const tx = await (
            await setupAuction({
              tokenId,
              duration,
              reservePrice,
            })
          ).wait();

          const event = tx.events[3];

          const {
            tokenId: tokenIdFromEvent,
            NftContractAddress,
            duration: durationFromEvent,
            reservePrice: reservePriceFromEvent,
            creator,
            fundsRecipient,
          } = event.args;

          expect(event.event).eq('AuctionCreated');
          expect(tokenIdFromEvent.toNumber()).eq(tokenId);
          expect(NftContractAddress).eq(mediaAddress);
          expect(durationFromEvent.toNumber()).eq(duration);
          expect(reservePriceFromEvent.toString()).eq(reservePrice.toString());
          expect(creator).eq(creatorWallet.address);
          expect(fundsRecipient).eq(fundsRecipientWallet.address);
        });
      });
    });
  });

  describe('#createBid', () => {
    beforeEach(async () => {
      await blockchain.resetAsync();
    });

    describe('sad path', () => {
      describe("when the auction doesn't exist", () => {
        it('should revert', async () => {
          const auctionAsCreator = await auctionAs(creatorWallet);
          const tokenId = 1;
          const amount = oneETH();

          await expect(
            auctionAsCreator.createBid(tokenId, amount, { value: oneETH() })
          ).rejectedWith(ERROR_MESSAGES.AUCTION_DOESNT_EXIST);
        });
      });

      describe('when the auction does exist', () => {
        describe("when the amount passed in doesn't equal msg.value", () => {
          it('should revert', async () => {
            const {
              tokenId,
              reservePrice,
              duration,
            } = await setupAuctionData();

            await setupAuction({
              tokenId,
              reservePrice,
              duration,
            });

            const auctionAsBidder = await auctionAs(firstBidderWallet);

            const twoETHBN = twoETH();

            await expect(
              auctionAsBidder.createBid(tokenId, reservePrice, {
                value: twoETHBN,
              })
            ).rejectedWith(ERROR_MESSAGES.INVALID_AMOUNT);
          });
        });

        describe('when the amount passed in is less than the previous bid amount', () => {
          it('should revert', async () => {
            const {
              tokenId,
              reservePrice,
              duration,
            } = await setupAuctionData();

            await setupAuction({
              tokenId,
              reservePrice,
              duration,
            });

            const auctionAsFirstBidder = await auctionAs(firstBidderWallet);

            await auctionAsFirstBidder.createBid(tokenId, oneETH(), {
              value: oneETH(),
            });

            const auctionAsSecondBidder = await auctionAs(secondBidderWallet);

            await expect(
              auctionAsSecondBidder.createBid(tokenId, oneETH(), {
                value: oneETH(),
              })
            ).rejectedWith(ERROR_MESSAGES.BID_TOO_LOW);
          });
        });

        describe('when the amount passed in is less than the minBid amount', () => {
          it('should revert', async () => {
            const {
              tokenId,
              reservePrice,
              duration,
            } = await setupAuctionData();

            await setupAuction({
              tokenId,
              reservePrice,
              duration,
            });

            const auctionAsFirstBidder = await auctionAs(firstBidderWallet);

            await auctionAsFirstBidder.createBid(tokenId, oneETH(), {
              value: oneETH(),
            });

            const auctionAsSecondBidder = await auctionAs(secondBidderWallet);

            const smallAmount = oneETH().add(BigNumber.from(10).mul(10));

            await expect(
              auctionAsSecondBidder.createBid(tokenId, smallAmount, {
                value: smallAmount,
              })
            ).rejectedWith(ERROR_MESSAGES.NOT_MIN_BID);
          });
        });

        describe('when the auction is over', () => {
          it('should revert', async () => {
            const {
              tokenId,
              reservePrice,
              duration,
            } = await setupAuctionData();

            await setupAuction({
              tokenId,
              reservePrice,
              duration,
            });

            const auctionAsBidder = await auctionAs(firstBidderWallet);

            await auctionAsBidder.createBid(tokenId, oneETH(), {
              value: oneETH(),
            });

            blockchain.increaseTimeAsync(duration);

            await expect(
              auctionAsBidder.createBid(tokenId, oneETH(), {
                value: oneETH(),
              })
            ).rejectedWith(ERROR_MESSAGES.AUCTION_EXPIRED);
          });
        });
      });
    });

    describe('happy path', () => {
      describe('when there is an existing bid', () => {
        it('should refund the previous bidder', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsFirstBidder = await auctionAs(firstBidderWallet);

          const originalBalance = await firstBidderWallet.getBalance();

          await auctionAsFirstBidder.createBid(tokenId, oneETH(), {
            value: oneETH().toString(),
          });

          const postBidBalance = await firstBidderWallet.getBalance();

          expect(postBidBalance.toString()).eq(
            originalBalance.sub(oneETH()).toString()
          );

          const auctionAsSecondBidder = await auctionAs(secondBidderWallet);

          await auctionAsSecondBidder.createBid(tokenId, twoETH(), {
            value: twoETH().toString(),
          });

          const currentBalance = await firstBidderWallet.getBalance();

          expect(currentBalance.toString()).eq(originalBalance.toString());
        });
      });
    });

    describe('when the transaction succeeds', () => {
      it('should emit an AuctionBid event', async () => {
        const { tokenId, reservePrice, duration } = await setupAuctionData();

        await setupAuction({
          tokenId,
          reservePrice,
          duration,
        });

        const auctionAsBidder = await auctionAs(firstBidderWallet);

        const { events } = await (
          await auctionAsBidder.createBid(tokenId, oneETH(), {
            value: oneETH(),
          })
        ).wait();

        const [auctionBidEvent] = events;

        expect(auctionBidEvent.event).eq('AuctionBid');
        expect(auctionBidEvent.args.tokenId.toNumber()).eq(tokenId);
        expect(auctionBidEvent.args.NftContractAddress).eq(mediaAddress);
        expect(auctionBidEvent.args.sender).eq(firstBidderWallet.address);
        expect(auctionBidEvent.args.value.toString()).eq(oneETH().toString());
      });
    });
  });
});
