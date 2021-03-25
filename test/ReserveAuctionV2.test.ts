import chai, { expect } from 'chai';
import asPromised from 'chai-as-promised';
import { JsonRpcProvider } from '@ethersproject/providers';
import {
  MarketFactory,
  MediaFactory,
  ReserveAuction,
  ReserveAuctionV2,
  ReserveAuctionV2Factory,
} from '../typechain';
import { generatedWallets } from '../utils/generatedWallets';
import { Wallet } from '@ethersproject/wallet';
import { BigNumber, ethers } from 'ethers';

chai.use(asPromised);

const provider = new JsonRpcProvider();

const ERROR_MESSAGES = {
  NOT_NFT: "Doesn't support NFT interface",
  NOT_OWNER: 'Ownable: caller is not the owner',
  AUCTION_ALREADY_EXISTS: 'Auction already exists',
};

let marketAddress: string;
let mediaAddress: string;
let auctionAddress: string;

const [
  deployerWallet,
  creatorWallet,
  fundsRecipientWallet,
  otherWallet,
] = generatedWallets(provider);

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

async function auctionAs(wallet: Wallet): Promise<ReserveAuctionV2> {
  return ReserveAuctionV2Factory.connect(auctionAddress, wallet);
}

describe('ReserveAuctionV2', () => {
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
        it('should set the zora address', async () => {
          const auction = await auctionAs(deployerWallet);
          expect(await auction.zora()).eq(mediaAddress);
        });
      });
    });
  });

  describe('#updateZora', () => {
    describe('sad path', () => {
      describe('when a non-owner tries to call the function', () => {
        it('should revert', async () => {
          const auction = await auctionAs(otherWallet);
          await expect(auction.updateZora(mediaAddress)).rejectedWith(
            ERROR_MESSAGES.NOT_OWNER
          );
        });
      });
    });

    describe('happy path', () => {
      describe('when the passed in address does meet the NFT standard', () => {
        it('should set the zora address', async () => {
          const auction = await auctionAs(deployerWallet);

          expect(await auction.zora()).eq(mediaAddress);

          const newMediaContract = await (
            await new MediaFactory(deployerWallet).deploy(marketAddress)
          ).deployed();

          await auction.updateZora(newMediaContract.address);

          expect(await auction.zora()).eq(newMediaContract.address);
        });
      });
    });

    // Reset zora so other tests don't break
    after(async () => {
      const auction = await auctionAs(deployerWallet);
      await auction.updateZora(mediaAddress);
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
    describe('sad path', () => {
      describe('when the auction already exists', () => {
        let auctionAsCreator: ReserveAuctionV2;
        let tokenId, duration, reservePrice;

        before(async () => {
          auctionAsCreator = await auctionAs(creatorWallet);

          // TODO: mint token using zora
          tokenId = 1;
          duration = 60 * 60 * 24; // 24 hours
          reservePrice = BigNumber.from(10).pow(18); // 1 ETH

          await (
            await auctionAsCreator.createAuction(
              tokenId,
              duration,
              reservePrice,
              creatorWallet.address,
              fundsRecipientWallet.address
            )
          ).wait();
        });

        it.only('should revert', async () => {
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
        let auctionAsCreator: ReserveAuctionV2;
        let tokenId, duration, reservePrice, event;

        before(async () => {
          auctionAsCreator = await auctionAs(creatorWallet);

          // TODO: mint token using zora
          tokenId = 2;
          duration = 60 * 60 * 24; // 24 hours
          reservePrice = BigNumber.from(10).pow(18); // 1 ETH

          const tx = await (
            await auctionAsCreator.createAuction(
              tokenId,
              duration,
              reservePrice,
              creatorWallet.address,
              fundsRecipientWallet.address
            )
          ).wait();

          event = tx.events[0];
        });

        it('should correctly set attributes', async () => {
          const auction = await auctionAsCreator.auctions(tokenId);

          expect(auction.exists).eq(true);
          expect(auction.reservePrice.toString()).eq(reservePrice.toString());
          expect(auction.duration.toNumber()).eq(duration);
          expect(auction.creator).eq(creatorWallet.address);
          expect(auction.fundsRecipient).eq(fundsRecipientWallet.address);
        });

        it('should transfer the NFT to the auction', () => {});

        it('should emit the AuctionCreated event', () => {
          const {
            tokenId: tokenIdFromEvent,
            zoraAddress,
            duration: durationFromEvent,
            reservePrice: reservePriceFromEvent,
            creator,
            fundsRecipient,
          } = event.args;

          expect(event.event).eq('AuctionCreated');
          expect(tokenIdFromEvent.toNumber()).eq(tokenId);
          expect(zoraAddress).eq(mediaAddress);
          expect(durationFromEvent.toNumber()).eq(duration);
          expect(reservePriceFromEvent.toString()).eq(reservePrice.toString());
          expect(creator).eq(creatorWallet.address);
          expect(fundsRecipient).eq(fundsRecipientWallet.address);
        });
      });
    });
  });
});
