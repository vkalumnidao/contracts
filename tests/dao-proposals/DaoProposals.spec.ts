import { DaoProposalsLocal } from "./DaoProposalsLocal";
import {
  Address,
  beginCell,
  Cell,
  CellMessage,
  CommonMessageInfo,
  ExternalMessage,
  InternalMessage,
  Slice,
  toNano,
} from "ton";
import { randomAddress } from "../utils/randomAddress";
import {
  DaoProposalsState,
  serializeIEvent,
  serializeProof,
  unserializeDaoProposalsState,
  unserializeProposal,
  IEvent,
} from "./DaoProposals.data";
import BN from "bn.js";
import { SbtItemSource } from "../sbt-item/SbtItem.source";
import { compileFunc } from "../utils/compileFunc";

const TON_TRUE = -1;
const TON_FALSE = 0;

export const cellToBoc = (cell: Cell) => {
  return cell.toBoc({ idx: false }).toString("base64");
};

const defaultConfig: DaoProposalsState = {
  owner_id: 100,
  proposals: new Map(),
  sbt_item_code: new Cell(),
  nft_collection_address: randomAddress(),
};

const fullConfig: DaoProposalsState = {
  owner_id: 1,
  sbt_item_code: new Cell(),
  nft_collection_address: randomAddress(),
  proposals: new Map([
    [
      0,
      {
        expiration_date: Date.now(),
        nay: new Map(),
        yay: new Map([[1, true]]),
        proposal: {
          kind: "add",
          candidate: {
            bio: {
              length: 4,
              text: "test",
            },
            id: 2,
          },
          description: {
            length: 4,
            text: "test",
          },
        },
      },
    ],
  ]),
};

function getState(state: Partial<DaoProposalsState>): DaoProposalsState {
  return { ...fullConfig, ...state };
}

const OWNER_ADDRESS = randomAddress();

function expectStateEquality(
  first: DaoProposalsState,
  second: DaoProposalsState
) {
  expect(first.owner_id).toEqual(first.owner_id);
  expect(first.nft_collection_address).toEqual(first.nft_collection_address);
  expect(first.proposals).toEqual(first.proposals);
  expect(first.sbt_item_code.toString()).toEqual(
    second.sbt_item_code.toString()
  );
}

describe("DAO proposals", () => {
  it("ignores external messages", async () => {
    let dao = await DaoProposalsLocal.createFromConfig(defaultConfig);

    let res = await dao.contract.sendExternalMessage(
      new ExternalMessage({
        to: dao.address,
        from: OWNER_ADDRESS,
        body: new CommonMessageInfo({
          body: new CellMessage(new Cell()),
        }),
      })
    );

    expect(res.exit_code).not.toEqual(0);
  });

  it("ignores empty messages", async () => {
    let dao = await DaoProposalsLocal.createFromConfig(defaultConfig);
    let res = await dao.contract.sendInternalMessage(
      new InternalMessage({
        to: dao.address,
        body: new CommonMessageInfo({
          body: new CellMessage(new Cell()),
        }),
        bounce: false,
        from: OWNER_ADDRESS,
        value: toNano(1),
      })
    );
    expect(res.exit_code).toEqual(0);
    expect(res.result).toEqual([]);
  });

  it("correctly serializes/deserializes state", async () => {
    let dao = await DaoProposalsLocal.createFromConfig(fullConfig);
    const result = await dao.contract.invokeGetMethod("storage_get_state", []);
    expect(result.type).toEqual("success");
    let returnedState = result.result[0] as Slice;
    const parsedState = unserializeDaoProposalsState(returnedState);
    expectStateEquality(parsedState, fullConfig);
  });

  it("returns owner_id correctly", async () => {
    let dao = await DaoProposalsLocal.createFromConfig({
      owner_id: 10,
      proposals: new Map(),
      sbt_item_code: new Cell(),
      nft_collection_address: randomAddress(),
    });
    const result = await dao.contract.invokeGetMethod(
      "storage_get_owner_id",
      []
    );
    expect(result.type).toEqual("success");
    const ownerId = result.result[0] as BN;
    expect(ownerId.toNumber()).toEqual(10);
  });

  it("returns proposal correctly", async () => {
    let dao = await DaoProposalsLocal.createFromConfig(fullConfig);
    const result = await dao.contract.invokeGetMethod(
      "storage_get_proposal_expiration_date",
      [
        {
          type: "int",
          value: "0",
        },
      ]
    );
    expect(result.type).toEqual("success");
    const expirationDate = result.result[0] as BN;
    expect(expirationDate.toNumber()).toEqual(
      fullConfig.proposals.get(0)?.expiration_date
    );
  });

  it("counts proposal yes votes", async () => {
    let dao = await DaoProposalsLocal.createFromConfig(fullConfig);
    const result = await dao.contract.invokeGetMethod(
      "storage_count_proposal_yays",
      [
        {
          type: "int",
          value: "0",
        },
      ]
    );
    expect(result.type).toEqual("success");
    const expirationDate = result.result[0] as BN;
    expect(expirationDate.toNumber()).toEqual(1);
  });

  it("counts proposal no votes", async () => {
    let dao = await DaoProposalsLocal.createFromConfig(fullConfig);
    const result = await dao.contract.invokeGetMethod(
      "storage_count_proposal_nays",
      [
        {
          type: "int",
          value: "0",
        },
      ]
    );
    expect(result.type).toEqual("success");
    const expirationDate = result.result[0] as BN;
    expect(expirationDate.toNumber()).toEqual(0);
  });

  it("returns proposal data", async () => {
    let dao = await DaoProposalsLocal.createFromConfig(fullConfig);
    const result = await dao.contract.invokeGetMethod(
      "storage_get_proposal_info",
      [
        {
          type: "int",
          value: "0",
        },
      ]
    );
    expect(result.type).toEqual("success");
    const returnedProposal = result.result[0] as Slice;
    const proposal = unserializeProposal(returnedProposal);
    expect(proposal).toEqual(fullConfig.proposals.get(0)?.proposal);
  });

  it("sends check proof operation with success", async () => {
    const sbtItemCode = await compileFunc(SbtItemSource);
    const daoCollectionAddress = randomAddress();

    let dao = await DaoProposalsLocal.createFromConfig(
      getState({
        sbt_item_code: sbtItemCode.cell,
        nft_collection_address: daoCollectionAddress,
      })
    );
    const membedId = 10;
    const ownerAddress = randomAddress();
    const expected_address_t = await dao.contract.invokeGetMethod(
      "calculate_nft_item_address_init",
      [
        {
          type: "int",
          value: membedId.toString(),
        },
        {
          type: "cell",
          value: cellToBoc(sbtItemCode.cell),
        },
        {
          type: "cell_slice",
          value: cellToBoc(
            beginCell().storeAddress(daoCollectionAddress).endCell()
          ),
        },
      ]
    );

    const expected_address = (
      expected_address_t.result[0] as Slice
    ).readAddress();

    const bodyCell = beginCell();
    serializeProof<IEvent>(
      bodyCell,
      {
        body: {
          kind: "check_proof",
        },
        index: 10,
        owner_address: ownerAddress,
        with_content: false,
      },
      serializeIEvent
    );
    let res = await dao.contract.sendInternalMessage(
      new InternalMessage({
        to: dao.address,
        body: new CommonMessageInfo({
          body: new CellMessage(bodyCell.endCell()),
        }),
        bounce: false,
        from: expected_address,
        value: toNano(1),
      })
    );
    expect(res.type).toEqual("success");
  });
});
