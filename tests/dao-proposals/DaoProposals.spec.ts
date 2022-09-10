import { DaoProposalsLocal } from "./DaoProposalsLocal";
import {
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
  unserializeDaoProposalsState,
} from "./DaoProposals.data";
import { TVMStackEntryNull } from "ton-contract-executor";

const defaultConfig: DaoProposalsState = {
  owner_id: 100,
  proposals: new Map(),
};
const OWNER_ADDRESS = randomAddress();

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
    const state: DaoProposalsState = {
      owner_id: 1,
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
    let dao = await DaoProposalsLocal.createFromConfig(state);
    const result = await dao.contract.invokeGetMethod("get_state", []);
    expect(result.type).toEqual("success");
    let returnedState = result.result[0] as Slice;
    const parsedState = unserializeDaoProposalsState(returnedState);
    expect(parsedState).toEqual(state);
  });
});
