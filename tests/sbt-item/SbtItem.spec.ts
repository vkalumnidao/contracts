import {
  Cell,
  CellMessage,
  CommonMessageInfo,
  ExternalMessage,
  InternalMessage,
  toNano,
} from "ton";
import { randomAddress } from "../utils/randomAddress";
import { SbtItemData, OperationCodes, Queries } from "./SbtItem.data";
import { SbtItemLocal } from "./SbtItemLocal";
import { SendMsgAction } from "ton-contract-executor";
import BN = require("bn.js");

import { Address } from "ton/dist";
import { ReserveCurrencyAction } from "ton-contract-executor/dist/utils/parseActionList";

const OWNER_ADDRESS = randomAddress();
const AUTHORITY_ADDRESS = randomAddress();
const COLLECTION_ADDRESS = randomAddress();

const defaultConfig: SbtItemData = {
  index: 777,
  collectionAddress: COLLECTION_ADDRESS,
  ownerAddress: OWNER_ADDRESS,
  authorityAddress: AUTHORITY_ADDRESS,
  content: "test",
  init: true,
};

describe("sbt item smc", () => {
  it("should ignore external messages", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);

    let res = await sbt.contract.sendExternalMessage(
      new ExternalMessage({
        to: sbt.address,
        from: OWNER_ADDRESS,
        body: new CommonMessageInfo({
          body: new CellMessage(new Cell()),
        }),
      })
    );

    expect(res.exit_code).not.toEqual(0);
  });

  it("should return item data", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);
    let res = await sbt.getNftData();
    if (!res.isInitialized) {
      throw new Error();
    }
    expect(res.isInitialized).toBe(true);
    expect(res.index).toEqual(defaultConfig.index);
    expect(res.collectionAddress!.toFriendly()).toEqual(
      defaultConfig.collectionAddress!.toFriendly()
    );
    expect(res.ownerAddress?.toFriendly()).toEqual(
      defaultConfig.ownerAddress!.toFriendly()
    );
    expect(res.content).toEqual(defaultConfig.content);
  });

  it("inintializes sbt item", async () => {
    let sbt = await SbtItemLocal.createFromConfig({
      ...defaultConfig,
      init: false,
    });
    expect(await sbt.getAuthority()).toBe(null);
    const auth = randomAddress();
    const res = await sbt.sendInit(defaultConfig.collectionAddress, {
      auth_address: auth,
      content: new Cell(),
      owner_address: randomAddress(),
    });
    expect(res.type).toEqual("success");
    expect((await sbt.getAuthority())?.toString()).toEqual(auth.toString());
  });

  it("should return editor", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);
    let res = await sbt.getEditor();
    expect(res).toEqual(null);
  });

  it("should not transfer", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);
    let newOwner = randomAddress();
    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: defaultConfig.ownerAddress,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.transfer({
              newOwner,
              forwardAmount: toNano("0.01"),
              responseTo: randomAddress(),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(401);
  });

  it("should transfer by authority", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);
    let newOwner = randomAddress();
    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: defaultConfig.authorityAddress,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.transfer({
              newOwner,
              forwardAmount: toNano("0.01"),
              responseTo: randomAddress(),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(0);

    let data = await sbt.getNftData();
    if (!data.isInitialized) {
      throw new Error();
    }

    expect(data.ownerAddress?.toFriendly()).toEqual(newOwner.toFriendly());
  });

  it("should not transfer by authority after destroy", async () => {
    let cfg = Object.create(defaultConfig);
    cfg.ownerAddress = null;
    let sbt = await SbtItemLocal.createFromConfig(cfg);
    let newOwner = randomAddress();
    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: defaultConfig.authorityAddress,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.transfer({
              newOwner,
              forwardAmount: toNano("0.01"),
              responseTo: randomAddress(),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(404);
  });

  it("should destroy", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);
    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: defaultConfig.ownerAddress,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(Queries.destroy({})),
        }),
      })
    );

    expect(res.exit_code).toEqual(0);
    let [reserve, responseMessage] = res.actionList as [
      ReserveCurrencyAction,
      SendMsgAction
    ];
    let response = responseMessage.message.body.beginParse();

    let op = response.readUintNumber(32);
    expect(op).toEqual(OperationCodes.excesses);
    expect(reserve.currency.coins.toNumber()).toEqual(
      toNano("0.05").toNumber()
    );

    let data = await sbt.getNftData();
    if (!data.isInitialized) {
      throw new Error();
    }

    expect(data.ownerAddress).toEqual(null);
    expect(await sbt.getAuthority()).toEqual(null);
  });

  it("should not destroy", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);
    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: defaultConfig.authorityAddress,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(Queries.destroy({})),
        }),
      })
    );

    expect(res.exit_code).toEqual(401);
  });

  it("random guy prove ownership", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);
    let someGuy = randomAddress();

    let dataCell = new Cell();
    dataCell.bits.writeUint(888, 16);

    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: someGuy,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.proveOwnership({
              to: randomAddress(),
              data: dataCell,
              withContent: true,
            })
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(401);
  });

  it("random guy request ownership", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);
    let someGuy = randomAddress();

    let dataCell = new Cell();
    dataCell.bits.writeUint(888, 16);

    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: someGuy,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.requestOwnerInfo({
              to: randomAddress(),
              data: dataCell,
              withContent: true,
            })
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(0);

    let [responseMessage] = res.actionList as [SendMsgAction];
    let response = responseMessage.message.body.beginParse();

    let op = response.readUintNumber(32);
    let queryId = response.readUintNumber(64);
    let index = response.readUintNumber(256);
    let sender = response.readAddress() as Address;
    let owner = response.readAddress() as Address;
    let data = response.readRef();
    let withCont = response.readBit();
    let cont = response.readRef();

    expect(op).toEqual(OperationCodes.OwnerInfo);
    expect(queryId).toEqual(0);
    expect(index).toEqual(777);
    expect(sender.toFriendly()).toEqual(someGuy.toFriendly());
    expect(owner.toFriendly()).toEqual(defaultConfig.ownerAddress.toFriendly());
    expect(data.readUint(16).toNumber()).toEqual(888);
    expect(withCont).toEqual(true);
    expect(cont.readBuffer(4).toString()).toEqual("test");
  });

  it("should request ownership with content", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);

    let requester = randomAddress();
    let dataCell = new Cell();
    dataCell.bits.writeUint(888, 16);

    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: requester,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.requestOwnerInfo({
              to: randomAddress(),
              data: dataCell,
              withContent: true,
            })
          ),
        }),
      })
    );
    expect(res.exit_code).toEqual(0);

    let [responseMessage] = res.actionList as [SendMsgAction];
    let response = responseMessage.message.body.beginParse();

    let op = response.readUintNumber(32);
    let queryId = response.readUintNumber(64);
    let index = response.readUintNumber(256);
    let sender = response.readAddress() as Address;
    let owner = response.readAddress() as Address;
    let data = response.readRef();
    let withCont = response.readBit();
    let cont = response.readRef();

    expect(op).toEqual(OperationCodes.OwnerInfo);
    expect(queryId).toEqual(0);
    expect(index).toEqual(777);
    expect(sender.toFriendly()).toEqual(requester.toFriendly());
    expect(owner.toFriendly()).toEqual(defaultConfig.ownerAddress.toFriendly());
    expect(data.readUint(16).toNumber()).toEqual(888);
    expect(withCont).toEqual(true);
    expect(cont.readBuffer(4).toString()).toEqual("test");
  });

  it("should prove ownership with content", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);

    let requester = randomAddress();
    let dataCell = new Cell();
    dataCell.bits.writeUint(888, 16);

    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: defaultConfig.ownerAddress,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.proveOwnership({
              to: randomAddress(),
              data: dataCell,
              withContent: true,
            })
          ),
        }),
      })
    );
    expect(res.exit_code).toEqual(0);

    let [responseMessage] = res.actionList as [SendMsgAction];
    let response = responseMessage.message.body.beginParse();

    let op = response.readUintNumber(32);
    let queryId = response.readUintNumber(64);
    let index = response.readUintNumber(256);
    let owner = response.readAddress() as Address;
    let data = response.readRef();
    let withCont = response.readBit();
    let cont = response.readRef();

    expect(op).toEqual(OperationCodes.OwnershipProof);
    expect(queryId).toEqual(0);
    expect(index).toEqual(777);
    expect(owner.toFriendly()).toEqual(defaultConfig.ownerAddress.toFriendly());
    expect(data.readUint(16).toNumber()).toEqual(888);
    expect(withCont).toEqual(true);
    expect(cont.readBuffer(4).toString()).toEqual("test");
  });

  it("should request ownership without content", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);

    let dataCell = new Cell();
    dataCell.bits.writeUint(888, 16);

    let guy = randomAddress();
    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        to: sbt.address,
        from: guy,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.requestOwnerInfo({
              to: randomAddress(),
              data: dataCell,
              withContent: false,
            })
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(0);

    let [responseMessage] = res.actionList as [SendMsgAction];
    let response = responseMessage.message.body.beginParse();

    let op = response.readUintNumber(32);
    let queryId = response.readUintNumber(64);
    let index = response.readUintNumber(256);
    let sender = response.readAddress() as Address;
    let owner = response.readAddress() as Address;
    let data = response.readRef();
    let withCont = response.readBit();

    expect(op).toEqual(OperationCodes.OwnerInfo);
    expect(queryId).toEqual(0);
    expect(index).toEqual(777);
    expect(sender.toFriendly()).toEqual(guy.toFriendly());
    expect(owner.toFriendly()).toEqual(defaultConfig.ownerAddress.toFriendly());
    expect(data.readUint(16).toNumber()).toEqual(888);
    expect(withCont).toEqual(false);
  });

  it("should verify ownership bounce to owner", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);

    let dataCell = new Cell();
    dataCell.bits.writeUint(888, 16);

    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        bounced: true,
        to: sbt.address,
        from: randomAddress(),
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.ownershipProof(
              {
                id: 777,
                owner: defaultConfig.ownerAddress,
                data: dataCell,
              },
              true
            )
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(0);

    let [responseMessage] = res.actionList as [SendMsgAction];
    let response = responseMessage.message.body.beginParse();

    let op = response.readUintNumber(32);
    let queryId = response.readUintNumber(64);
    let index = response.readUintNumber(256);
    let owner = response.readAddress() as Address;
    response.readBit();
    let data = response.readRef();

    expect(op).toEqual(OperationCodes.OwnershipProofBounced);
    expect(queryId).toEqual(0);
    expect(index).toEqual(777);
    expect(owner.toFriendly()).toEqual(defaultConfig.ownerAddress.toFriendly());
    expect(data.readUint(16).toNumber()).toEqual(888);
  });

  it("should prove proof bounce to initiator", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);

    let dataCell = new Cell();
    dataCell.bits.writeUint(888, 16);

    let initer = randomAddress();

    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        bounced: true,
        to: sbt.address,
        from: randomAddress(),
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.ownerInfo(
              {
                id: 777,
                initiator: initer,
                owner: defaultConfig.ownerAddress,
                data: dataCell,
              },
              true
            )
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(0);

    let [responseMessage] = res.actionList as [SendMsgAction];
    let response = responseMessage.message.body.beginParse();

    let op = response.readUintNumber(32);
    let queryId = response.readUintNumber(64);
    let index = response.readUintNumber(256);
    let initiator = response.readAddress() as Address;
    let owner = response.readAddress() as Address;
    response.readBit();
    let data = response.readRef();

    expect(op).toEqual(OperationCodes.OwnerInfoBounced);
    expect(queryId).toEqual(0);
    expect(index).toEqual(777);
    expect(initiator.toFriendly()).toEqual(initer.toFriendly());
    expect(owner.toFriendly()).toEqual(defaultConfig.ownerAddress.toFriendly());
    expect(data.readUint(16).toNumber()).toEqual(888);
  });

  it("should not verify ownership non bounced", async () => {
    let sbt = await SbtItemLocal.createFromConfig(defaultConfig);

    let dataCell = new Cell();
    dataCell.bits.writeUint(888, 16);

    let res = await sbt.contract.sendInternalMessage(
      new InternalMessage({
        bounced: false,
        to: sbt.address,
        from: randomAddress(),
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.ownershipProof({
              id: 777,
              owner: randomAddress(),
              data: dataCell,
            })
          ),
        }),
      })
    );

    expect(res.exit_code).toEqual(0xffff);
  });
});
