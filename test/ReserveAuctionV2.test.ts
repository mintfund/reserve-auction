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
  WethFactory,
  CrowdfundV2Factory,
  EthRejecterFactory,
  EthRejecter,
  EthReceiverFactory,
  EthReceiver
} from '../typechain';
import Decimal from '../utils/Decimal';
import { generatedWallets } from '../utils/generatedWallets';
import { Wallet } from '@ethersproject/wallet';
import { BigNumber, Bytes, ContractTransaction, ethers } from 'ethers';
import { recoverAddress, sha256 } from 'ethers/lib/utils';
import { signPermit } from './utils';

chai.use(asPromised);

const provider = new JsonRpcProvider();
const blockchain = new Blockchain(provider);

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

const ERROR_MESSAGES = {
  NOT_NFT: "Doesn't support NFT interface",
  NOT_OWNER: 'Ownable: caller is not the owner',
  AUCTION_ALREADY_EXISTS: 'Auction already exists',
  AUCTION_DOESNT_EXIST: "Auction doesn't exist",
  INVALID_AMOUNT: "Amount doesn't equal msg.value",
  AUCTION_EXPIRED: 'Auction expired',
  BID_TOO_LOW: 'Must send more than last bid',
  NOT_MIN_BID: 'Must send more than last bid by MIN_BID amount',
  ONLY_AUCTION_CREATOR: 'Can only be called by auction creator',
  AUCTION_ALREADY_STARTED: 'Auction already started',
  AUCTION_HASNT_BEGUN: "Auction hasn't begun",
  AUCTION_HASNT_COMPLETED: "Auction hasn't completed",
  CALLER_NOT_ADMIN: 'Caller does not have admin privileges',
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
let wethAddress: string;
let ethRejecterAddress: string;
let ethReceiverAddress: string;

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
  adminRecoveryAddress,
] = generatedWallets(provider);

function twoETH(): BigNumber {
  return BigNumber.from(10).pow(18).mul(2);
}

function oneETH(): BigNumber {
  return BigNumber.from(10).pow(18);
}

function halfETH(): BigNumber {
  return BigNumber.from(10).pow(18).div(0.5);
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

  const weth = await (
    await new WethFactory(deployerWallet).deploy()
  ).deployed();

  wethAddress = weth.address;

  const ethRejecter = await (
    await new EthRejecterFactory(deployerWallet).deploy()
  ).deployed();

  ethRejecterAddress = ethRejecter.address;

  const ethReceiver = await (
    await new EthReceiverFactory(deployerWallet).deploy()
  ).deployed();

  ethReceiverAddress = ethReceiver.address;

  const auction = await (
    await new ReserveAuctionV2Factory(deployerWallet).deploy(
      mediaAddress,
      wethAddress,
      adminRecoveryAddress.address
    )
  ).deployed();

  auctionAddress = auction.address;
}

async function mediaAs(wallet: Wallet) {
  return MediaFactory.connect(mediaAddress, wallet);
}

async function marketAs(wallet: Wallet) {
  return MarketFactory.connect(marketAddress, wallet);
}

async function wethAs(wallet: Wallet) {
  return WethFactory.connect(wethAddress, wallet);
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

async function ethRejecterAs(wallet: Wallet): Promise<EthRejecter> {
  return EthRejecterFactory.connect(ethRejecterAddress, wallet);
}

async function ethReceiverAs(wallet: Wallet): Promise<EthReceiver> {
  return EthReceiverFactory.connect(ethReceiverAddress, wallet);
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

async function resetBlockchain() {
  await blockchain.resetAsync();

  metadataHex = ethers.utils.formatBytes32String('{}');
  metadataHash = await sha256(metadataHex);
  metadataHashBytes = ethers.utils.arrayify(metadataHash);

  contentHex = ethers.utils.formatBytes32String('invert');
  contentHash = await sha256(contentHex);
  contentHashBytes = ethers.utils.arrayify(contentHash);

  otherContentHex = ethers.utils.formatBytes32String('otherthing');
  otherContentHash = await sha256(otherContentHex);
}

async function getGasAmountFromTx(tx) {
  const txReceipt = await tx.wait();

  const gasUsed = txReceipt.gasUsed;
  const gasPrice = tx.gasPrice;

  return gasUsed.mul(gasPrice);
}

describe('ReserveAuctionV2', () => {
  beforeEach(async () => {
    await deploy();
  });

  describe('#constructor', () => {
    describe('happy path', () => {
      describe('when the passed in address does meet the NFT standard', () => {
        it('should set the variables correctly', async () => {
          const auction = await auctionAs(deployerWallet);
          expect(await auction.nftContract()).eq(mediaAddress);
          expect(await auction.wethAddress()).eq(wethAddress);
        });
      });
    });
  });

  describe('#createAuction', () => {
    beforeEach(async () => {
      await resetBlockchain();
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
      let tx;

      describe('when an auction is created', () => {
        it('should set the attributes correctly', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          tx = await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsCreator = await auctionAs(creatorWallet);
          const auction = await auctionAsCreator.auctions(tokenId);

          expect(auction.reservePrice.toString()).eq(reservePrice.toString());
          expect(auction.duration.toNumber()).eq(duration);
          expect(auction.creator).eq(creatorWallet.address);
          expect(auction.fundsRecipient).eq(fundsRecipientWallet.address);
        });

        it('should use 172292 gas', async () => {
          const receipt = await tx.wait();
          const { gasUsed } = receipt;
          expect(gasUsed.toString()).to.eq('172292');
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
            nftContractAddress,
            duration: durationFromEvent,
            reservePrice: reservePriceFromEvent,
            creator,
            fundsRecipient,
          } = event.args;

          expect(event.event).eq('AuctionCreated');
          expect(tokenIdFromEvent.toNumber()).eq(tokenId);
          expect(nftContractAddress).eq(mediaAddress);
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
      await resetBlockchain();
      await deploy();
    });

    describe('errors', () => {
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

    describe('successful cases', () => {
      describe('when there is an existing bid', () => {
        let tx;

        it('should refund the previous bidder', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsFirstBidder = await auctionAs(firstBidderWallet);

          const originalBalance = await firstBidderWallet.getBalance();

          tx = await auctionAsFirstBidder.createBid(tokenId, oneETH(), {
            value: oneETH(),
          });

          const gasAmount = await getGasAmountFromTx(tx);

          const postBidBalance = await firstBidderWallet.getBalance();

          expect(postBidBalance.toString()).eq(
            originalBalance.sub(gasAmount).sub(oneETH()).toString()
          );

          const auctionAsSecondBidder = await auctionAs(secondBidderWallet);

          tx = await auctionAsSecondBidder.createBid(tokenId, twoETH(), {
            value: twoETH(),
          });

          const currentBalance = await firstBidderWallet.getBalance();

          expect(currentBalance.toString()).eq(
            originalBalance.sub(gasAmount).toString()
          );
        });

        it('should use 66637 gas', async () => {
          const receipt = await tx.wait();
          const { gasUsed } = receipt;
          expect(gasUsed.toString()).to.eq('66637');
        });
      });
    });

    describe('when the transaction succeeds', () => {
      let tx;

      it('should set the amount to the last bid', async () => {
        const { tokenId, reservePrice, duration } = await setupAuctionData();

        await setupAuction({
          tokenId,
          reservePrice,
          duration,
        });

        const auctionAsBidder = await auctionAs(firstBidderWallet);

        tx = await auctionAsBidder.createBid(tokenId, twoETH(), {
          value: twoETH(),
        });

        const auction = await auctionAsBidder.auctions(tokenId);

        expect(auction.amount.toString()).eq(twoETH().toString());
      });

      it('should cost 105436 gas', async () => {
        const receipt = await tx.wait();
        const { gasUsed } = receipt;
        expect(gasUsed.toString()).to.eq('105436');
      });

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
        expect(auctionBidEvent.args.nftContractAddress).eq(mediaAddress);
        expect(auctionBidEvent.args.sender).eq(firstBidderWallet.address);
        expect(auctionBidEvent.args.value.toString()).eq(oneETH().toString());
      });
    });
  });

  describe('#cancelAuction', () => {
    beforeEach(async () => {
      await resetBlockchain();
      await deploy();
    });

    describe('sad path', () => {
      describe("when the auction doesn't exist", () => {
        it('should revert', async () => {
          const auctionAsCreator = await auctionAs(creatorWallet);
          await expect(auctionAsCreator.cancelAuction(0)).rejectedWith(
            ERROR_MESSAGES.AUCTION_DOESNT_EXIST
          );
        });
      });

      describe('when the sender is not the creator', () => {
        it('should revert', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsOther = await auctionAs(otherWallet);

          await expect(auctionAsOther.cancelAuction(tokenId)).rejectedWith(
            ERROR_MESSAGES.ONLY_AUCTION_CREATOR
          );
        });
      });

      describe('when a bid has already been sent', () => {
        it('should revert', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsBidder = await auctionAs(firstBidderWallet);

          await auctionAsBidder.createBid(tokenId, oneETH(), {
            value: oneETH(),
          });

          const auctionAsCreator = await auctionAs(creatorWallet);

          await expect(auctionAsCreator.cancelAuction(tokenId)).rejectedWith(
            ERROR_MESSAGES.AUCTION_ALREADY_STARTED
          );
        });
      });
    });

    describe('happy path', () => {
      it('should delete the auction', async () => {
        const { tokenId, reservePrice, duration } = await setupAuctionData();

        await setupAuction({
          tokenId,
          reservePrice,
          duration,
        });

        const auctionAsCreator = await auctionAs(creatorWallet);
        await auctionAsCreator.cancelAuction(tokenId);
        const auction = await auctionAsCreator.auctions(tokenId);
        expect(auction.creator).eq(NULL_ADDRESS);
      });

      it('should transfer the NFT back to the creator', async () => {
        const { tokenId, reservePrice, duration } = await setupAuctionData();

        const nftContractAsCreator = await mediaAs(creatorWallet);

        const nftOwnerBeforeCreateAuction = await nftContractAsCreator.ownerOf(
          tokenId
        );

        expect(nftOwnerBeforeCreateAuction).eq(creatorWallet.address);

        await setupAuction({
          tokenId,
          reservePrice,
          duration,
        });

        const nftOwnerAfterCreateAuction = await nftContractAsCreator.ownerOf(
          tokenId
        );

        expect(nftOwnerAfterCreateAuction).eq(auctionAddress);

        const auctionAsCreator = await auctionAs(creatorWallet);

        await auctionAsCreator.cancelAuction(tokenId);

        const nftOwnerAfterCancelAuction = await nftContractAsCreator.ownerOf(
          tokenId
        );

        expect(nftOwnerAfterCancelAuction).eq(creatorWallet.address);
      });

      it('should emit the AuctionCanceled event', async () => {
        const { tokenId, reservePrice, duration } = await setupAuctionData();

        await setupAuction({
          tokenId,
          reservePrice,
          duration,
        });

        const auctionAsCreator = await auctionAs(creatorWallet);

        const { events } = await (
          await auctionAsCreator.cancelAuction(tokenId)
        ).wait();

        const auctionCanceledEvent = events[3];

        expect(auctionCanceledEvent.event).eq('AuctionCanceled');
        expect(auctionCanceledEvent.args.tokenId.toNumber()).eq(tokenId);
        expect(auctionCanceledEvent.args.nftContractAddress).eq(mediaAddress);
        expect(auctionCanceledEvent.args.creator).eq(creatorWallet.address);
      });
    });
  });

  /*
    Admin Functions
  */

  describe('admin function', () => {
    let balanceBefore;
    let auctionAsCreator;
    let nftId;

    beforeEach(async () => {
      const { tokenId, reservePrice, duration } = await setupAuctionData();
      nftId = tokenId;

      await setupAuction({
        tokenId,
        reservePrice,
        duration,
      });

      auctionAsCreator = await auctionAs(creatorWallet);

      const tx = await auctionAsCreator.createBid(tokenId, twoETH(), {
        value: twoETH(),
      });

      await tx.wait();

      balanceBefore = await provider.getBalance(auctionAsCreator.address);
    });

    describe('#transferETH', () => {
      describe('when called by a random address', () => {
        it('reverts', async () => {
          // Sanity check that balance before is 2 ETH.
          expect(balanceBefore.toString()).to.eq(twoETH().toString());

          const tx = auctionAsCreator.recoverETH(twoETH());
          // Transaction should revert.
          await expect(tx).rejectedWith(ERROR_MESSAGES.CALLER_NOT_ADMIN);

          // Balance should be unchanged.
          const balanceAfter = await provider.getBalance(
            auctionAsCreator.address
          );
          expect(balanceAfter.toString()).to.eq(balanceBefore.toString());
        });
      });

      describe('when called by the admin recovery address', () => {
        let gasAmount;
        let adminBalanceBefore;

        beforeEach(async () => {
          adminBalanceBefore = await provider.getBalance(
            adminRecoveryAddress.address
          );

          const auctionAsAdmin = await auctionAs(adminRecoveryAddress);
          const tx = await auctionAsAdmin.recoverETH(twoETH());
          // Transaction should complete.
          await tx.wait();

          gasAmount = await getGasAmountFromTx(tx);
        });

        it('decreases ETH in the auction contract to 0', async () => {
          // Sanity check that balance before is 2 ETH.
          expect(balanceBefore.toString()).to.eq(twoETH().toString());
          // Balance afterwards should be zero.
          const balanceAfter = await provider.getBalance(
            auctionAsCreator.address
          );
          expect(balanceAfter.toString()).to.eq('0');
        });

        it('increases the ETH balance in the recovery address', async () => {
          // Balance should be transferred to the admin.
          const adminBalance = await provider.getBalance(
            adminRecoveryAddress.address
          );
          expect(
            // The amount that got added is equal to the current balance, minus
            // the original balance, plus thas gas used.
            adminBalance.sub(adminBalanceBefore).add(gasAmount).toString()
          ).to.eq(balanceBefore.toString());
        });
      });

      describe('turnOffAdminRecovery', () => {
        describe('when called by a random address', () => {
          it('reverts', async () => {
            const auctionAsAdmin = await auctionAs(adminRecoveryAddress);
            const adminRecovery = await auctionAsAdmin.adminRecovery();
            expect(adminRecovery).to.eq(true);

            const badTx = auctionAsCreator.turnOffAdminRecovery();
            // Transaction should revert.
            await expect(badTx).rejectedWith(ERROR_MESSAGES.CALLER_NOT_ADMIN);
          });
        });

        describe('when called by admin', () => {
          it('sets adminRecovery to false', async () => {
            const auctionAsAdmin = await auctionAs(adminRecoveryAddress);
            await await auctionAsAdmin.turnOffAdminRecovery();

            const adminRecovery = await auctionAsAdmin.adminRecovery();
            expect(adminRecovery).to.eq(false);
          });

          it('prevents all admin actions being called', async () => {
            const auctionAsAdmin = await auctionAs(adminRecoveryAddress);
            await await auctionAsAdmin.turnOffAdminRecovery();

            const tx = auctionAsAdmin.recoverETH(twoETH());
            // Transaction should revert even when called by admin,
            // because admin is turned off.
            await expect(tx).rejectedWith(ERROR_MESSAGES.CALLER_NOT_ADMIN);
          });
        });
      });
    });

    describe('#transferNFT', () => {
      describe('when called by a random address', () => {
        it('reverts', async () => {
          // Sanity check ownership of NFT is the auction.
          const zoraMediaAsCreator = await mediaAs(creatorWallet);
          const ownerBefore = await zoraMediaAsCreator.ownerOf(nftId);
          expect(ownerBefore).to.eq(auctionAsCreator.address);

          const tx = auctionAsCreator.recoverNFT(nftId);
          // Transaction should revert.
          await expect(tx).rejectedWith(ERROR_MESSAGES.CALLER_NOT_ADMIN);

          // Ownership should be unchanged.
          const ownerAfter = await zoraMediaAsCreator.ownerOf(nftId);
          expect(ownerAfter).to.eq(auctionAsCreator.address);
        });
      });

      describe('when called by the admin recovery address', () => {
        it('transfers the NFT', async () => {
          // Sanity check ownership of NFT is the auction.
          const zoraMediaAsCreator = await mediaAs(adminRecoveryAddress);
          const ownerBefore = await zoraMediaAsCreator.ownerOf(nftId);
          expect(ownerBefore).to.eq(auctionAsCreator.address);

          const auctionAsAdmin = await auctionAs(adminRecoveryAddress);
          const tx = await auctionAsAdmin.recoverNFT(nftId);
          // Transaction should complete.
          await tx.wait();

          // Ownership should be updated to the admin recovery account.
          const ownerAfter = await zoraMediaAsCreator.ownerOf(nftId);
          expect(ownerAfter).to.eq(adminRecoveryAddress.address);
        });
      });
    });
  });

  describe('#endAuction', () => {
    beforeEach(async () => {
      await resetBlockchain();
      await deploy();
    });

    describe('sad path', () => {
      describe("when ending an auction that doesn't exist", () => {
        it('should revert', async () => {
          const auctionAsCreator = await auctionAs(creatorWallet);
          await expect(auctionAsCreator.endAuction(100)).rejectedWith(
            ERROR_MESSAGES.AUCTION_HASNT_COMPLETED
          );
        });
      });

      describe("when ending an auction that hasn't begun", () => {
        it('should revert', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsCreator = await auctionAs(creatorWallet);

          await expect(auctionAsCreator.endAuction(tokenId)).rejectedWith(
            ERROR_MESSAGES.AUCTION_HASNT_COMPLETED
          );
        });
      });

      describe("when ending an auction that hasn't completed", () => {
        it('should revert', async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsBidder = await auctionAs(firstBidderWallet);

          const tx = await auctionAsBidder.createBid(tokenId, twoETH(), {
            value: twoETH(),
          });

          await tx.wait();

          await expect(auctionAsBidder.endAuction(tokenId)).rejectedWith(
            ERROR_MESSAGES.AUCTION_HASNT_COMPLETED
          );
        });
      });
    });

    describe('happy path', () => {
      describe('when there is one bidder', () => {
        let nftOwnerBeforeEndAuction,
          nftOwnerAfterEndAuction,
          auctionBeforeEndAuction,
          auctionAfterEndAuction,
          beforeCreatorBalance,
          afterCreatorBalance,
          beforeFundsRecipientBalance,
          afterFundsRecipientBalance,
          creatorAmount;
        let receipt;

        beforeEach(async () => {
          const { tokenId, reservePrice, duration } = await setupAuctionData();

          await setupAuction({
            tokenId,
            reservePrice,
            duration,
          });

          const auctionAsBidder = await auctionAs(firstBidderWallet);

          let tx = await auctionAsBidder.createBid(tokenId, twoETH(), {
            value: twoETH(),
          });

          await tx.wait();
          await blockchain.increaseTimeAsync(duration);

          const nftContractAsCreator = await mediaAs(creatorWallet);

          nftOwnerBeforeEndAuction = await nftContractAsCreator.ownerOf(
            tokenId
          );

          auctionBeforeEndAuction = await auctionAsBidder.auctions(tokenId);
          beforeCreatorBalance = await creatorWallet.getBalance();
          beforeFundsRecipientBalance = await fundsRecipientWallet.getBalance();

          const market = await marketAs(creatorWallet);
          const creatorShare = await market.bidSharesForToken(tokenId);

          creatorAmount = await market.splitShare(
            creatorShare.creator,
            twoETH()
          );

          const endAuctionTx = await auctionAsBidder.endAuction(tokenId);
          receipt = await endAuctionTx.wait();

          nftOwnerAfterEndAuction = await nftContractAsCreator.ownerOf(tokenId);
          auctionAfterEndAuction = await auctionAsBidder.auctions(tokenId);
          afterCreatorBalance = await creatorWallet.getBalance();
          afterFundsRecipientBalance = await fundsRecipientWallet.getBalance();
        });

        it('should delete the auction', () => {
          expect(auctionBeforeEndAuction.creator).eq(creatorWallet.address);
          expect(auctionAfterEndAuction.creator).eq(NULL_ADDRESS);
        });

        it('should transfer the NFT from the auction to the winning bidder', () => {
          expect(nftOwnerBeforeEndAuction).eq(auctionAddress);
          expect(nftOwnerAfterEndAuction).eq(firstBidderWallet.address);
        });

        it('should send the creator share to the original creator', () => {
          expect(afterCreatorBalance.toString()).eq(
            beforeCreatorBalance.add(creatorAmount).toString()
          );
        });

        it('should send the rest of the bid amount to the funds recipient', () => {
          expect(afterFundsRecipientBalance.toString()).eq(
            beforeFundsRecipientBalance
              .add(twoETH())
              .sub(creatorAmount)
              .toString()
          );
        });

        it('should cost 102420 gas', () => {
          const { gasUsed } = receipt;
          expect(gasUsed.toString()).to.eq('102420');
        });
      });
    });

    describe('when there are two bidders', () => {
      let nftOwnerBeforeEndAuction, nftOwnerAfterEndAuction;

      beforeEach(async () => {
        const { tokenId, reservePrice, duration } = await setupAuctionData();

        await setupAuction({
          tokenId,
          reservePrice,
          duration,
        });

        const auctionAsFirstBidder = await auctionAs(firstBidderWallet);
        const auctionAsSecondBidder = await auctionAs(secondBidderWallet);

        let tx = await auctionAsFirstBidder.createBid(tokenId, oneETH(), {
          value: oneETH(),
        });
        await tx.wait();

        tx = await auctionAsSecondBidder.createBid(tokenId, twoETH(), {
          value: twoETH(),
        });
        await tx.wait();

        await blockchain.increaseTimeAsync(duration);

        const nftContractAsCreator = await mediaAs(creatorWallet);

        nftOwnerBeforeEndAuction = await nftContractAsCreator.ownerOf(tokenId);

        tx = await auctionAsSecondBidder.endAuction(tokenId);
        tx.wait();

        nftOwnerAfterEndAuction = await nftContractAsCreator.ownerOf(tokenId);
      });

      it('should send the NFT to the second bidder', () => {
        expect(nftOwnerBeforeEndAuction).eq(auctionAddress);
        expect(nftOwnerAfterEndAuction).eq(secondBidderWallet.address);
      });
    });

    describe('when the first bidder is a contract that rejects ETH and is outbid', () => {
      let receipt;

      beforeEach(async () => {
        const { tokenId, reservePrice, duration } = await setupAuctionData();

        await setupAuction({
          tokenId,
          reservePrice,
          duration,
        });

        const rejecter = await ethRejecterAs(firstBidderWallet);
        const auctionAsSecondBidder = await auctionAs(secondBidderWallet);
          
        let tx = await rejecter.relayBid(auctionAddress, tokenId, oneETH(), {
          value: oneETH(),
        });

        await tx.wait();

        tx = await auctionAsSecondBidder.createBid(tokenId, twoETH(), {
          value: twoETH(),
          gasLimit: 3000000
        });
        receipt = await tx.wait();
      });

      it('returns the contract\'s ETH back in WETH', async () => {
        const balance = await provider.getBalance(ethRejecterAddress);
        expect(balance.toString()).to.eq("0");
        
        const wethAsBidder = wethAs(firstBidderWallet);
        const contractWethBalance = (await wethAsBidder).balanceOf(
          ethRejecterAddress
        );

        expect((await contractWethBalance).toString()).to.eq(oneETH().toString());
      });

      it('should cost 143310 gas', () => {
        const { gasUsed } = receipt;
        expect(gasUsed.toString()).to.eq('143310');
      });
    });

    describe('when the first bidder is a contract that accepts ETH but uses more gas', () => {
      let receipt;

      beforeEach(async () => {
        const { tokenId, reservePrice, duration } = await setupAuctionData();

        await setupAuction({
          tokenId,
          reservePrice,
          duration,
        });

        const receiver = await ethReceiverAs(firstBidderWallet);
        const auctionAsSecondBidder = await auctionAs(secondBidderWallet);
          
        let tx = await receiver.relayBid(auctionAddress, tokenId, oneETH(), {
          value: oneETH(),
        });

        await tx.wait();

        tx = await auctionAsSecondBidder.createBid(tokenId, twoETH(), {
          value: twoETH(),
          gasLimit: 3000000
        });
        receipt = await tx.wait();
      });

      it('returns the contract\'s ETH back in ETH', async () => {
        const balance = await provider.getBalance(ethReceiverAddress);
        expect(balance.toString()).to.eq(oneETH().toString());
        
        const wethAsBidder = wethAs(firstBidderWallet);
        const contractWethBalance = (await wethAsBidder).balanceOf(
          ethReceiverAddress
        );

        expect((await contractWethBalance).toString()).to.eq("0");
      });

      it('should cost 90898 gas', () => {
        const { gasUsed } = receipt;
        expect(gasUsed.toString()).to.eq('90898');
      });
    });
  });
});
