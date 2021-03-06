const dotenv = require('dotenv');
dotenv.config();

const LetterOfCredit = artifacts.require("LetterOfCredit");
const { time } = require('openzeppelin-test-helpers');

contract('Letter of Credit buyer cancellation flow', async accounts => {
    
    const accs = {
        buyer: accounts[0],
        seller: accounts[1],
        shippingManager: accounts[2],
        attacker: accounts[3],
    }

    let letterOfCreditContract;

    let expectThrow = async(promise) => {
        try {
            await promise;
        } catch (error) {
            const invalidOpcode = error.message.search('invalid opcode') >= 0;
            const outOfGas = error.message.search('out of gas') >= 0;
            const revert = error.message.search('revert') >= 0;
            assert(
              invalidOpcode || outOfGas || revert,
              "Expected throw, got '" + error + "' instead",
            );
            return;
        }
        assert.fail('Expected throw not received');
    }
    
    before('deploying letter of credit contract', async() => {

        //deploy a contract
        letterOfCreditContract = await LetterOfCredit.new(accs.buyer, accs.seller, accs.shippingManager, { from: accs.buyer });
        console.log('[DEBUG] Deployed LetterOfCredit contract, address: ' + letterOfCreditContract.address)
    });

    it('creating bargain', async() => {
        let bargainSum = web3.utils.toWei("5", 'ether');
        
        let blocknumber = await web3.eth.getBlockNumber();
        let block = await web3.eth.getBlock(blocknumber);
        let bargainDeadline = block.timestamp + 1000;

        //only buyer can initialize it <- that's due to how letter of credit works in real life.
        await expectThrow(
            letterOfCreditContract.createBargain(bargainSum, bargainDeadline, 'description', { from: accs.attacker })
        );
        await expectThrow(
            letterOfCreditContract.createBargain(bargainSum, bargainDeadline, 'description', { from: accs.seller })
        );
        await expectThrow(
            letterOfCreditContract.createBargain(bargainSum, bargainDeadline, 'description', { from: accs.shippingManager })
        );

        //bargain sum should be gt 0
        await expectThrow(
            letterOfCreditContract.createBargain(0, bargainDeadline, 'description', { from: accs.buyer })
        );
        await expectThrow(
            letterOfCreditContract.createBargain(-100, bargainDeadline, 'description', { from: accs.buyer })
        );

        //msg.value should be equal to bargainSum
        await expectThrow(
            letterOfCreditContract.createBargain(bargainSum, bargainDeadline, 'description', { from: accs.buyer, value: web3.utils.toWei("10", "ether") })
        );

        //invalid bargain period
        await expectThrow(
            letterOfCreditContract.createBargain(bargainSum, bargainDeadline + 100000000000, 'description', { from: accs.buyer, value: bargainSum })
        );

        //Create valid letter of credit
        await letterOfCreditContract.createBargain(bargainSum, bargainDeadline, 'valid bargain', { from: accs.buyer, value: bargainSum});
        
        // INIT state
        let state = await letterOfCreditContract.bargainInitializedBy.call(accs.buyer);
        assert.equal(state.bargainState.valueOf(), 1);
    });

    it('buyer gets considired that seller could be trusted and changes state', async() => {
        /*
         Once a bargain created and contract state is set to INIT, buyer should consider that seller could be trusted, he has a wanted product/service. 
         When it's done, buyer changes state to VALIDATED. If doubts about seller occure, buyer can call cancelBargainBuyer and get his ether back.        
         For the base flow we would not test bargain cancellation.
         */
        
        // doubts occured
        let ZS = 0
        let buyer_balance_beforeCancellation = await web3.eth.getBalance(accs.buyer);

        //invalid access
        await expectThrow(letterOfCreditContract.cancelBargainBuyer({ from: accs.attacker }));
        let bargain = await letterOfCreditContract.bargainInitializedBy.call(accs.buyer);
        let bargainSum = bargain.bargainSum;

        await letterOfCreditContract.cancelBargainBuyer({ from: accs.buyer });

        let buyer_balance_afterCancellation = await web3.eth.getBalance(accs.buyer);
        let state = await letterOfCreditContract.bargainInitializedBy.call(accs.buyer); // dup code...

        assert.equal(state.bargainState.valueOf(), ZS);
        
        //after call to cancelBargainBuyer
        const totalGas = 466560000000000;
        assert.equal(Number(buyer_balance_beforeCancellation) + Number(bargainSum) - totalGas, buyer_balance_afterCancellation.valueOf());
    });
})