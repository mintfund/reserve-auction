import chai, { expect } from 'chai';
import asPromised from 'chai-as-promised';
import { JsonRpcProvider } from '@ethersproject/providers';
import {
  MarketFactory,
  MediaFactory,
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
};

let marketAddress: string;
let mediaAddress: string;
let auctionAddress: string;

const [deployerWallet, otherWallet] = generatedWallets(provider);

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

async function auctionAs(wallet: Wallet) {
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
    describe('sad path', () => {});
  });
});
