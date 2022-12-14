import { DaoProposalsLocal } from "./DaoProposalsLocal";
import { SendMsgAction } from "ton-contract-executor";
import {
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
  unserializeDaoProposalsState,
  unserializeProposal,
  Proposal,
  ProposalState,
  ProposalAdd,
  ProposalRemove,
  ProposalGeneric,
  serializeMemberInfo,
  Candidate,
  unserializeSBTInit,
  SBTInit,
} from "./DaoProposals.data";
import BN, { min } from "bn.js";
import { SbtItemSource } from "../sbt-item/SbtItem.source";
import { compileFunc } from "../utils/compileFunc";
import {
  OperationCodes,
  Queries as SbtQueries,
} from "../sbt-item/SbtItem.data";

const DICT_ERROR = 10;
const INVALID_ACTION_ERROR = 34;
const DOUBLE_VOTE_ERROR = 1001;
const UNKNOWN_PROPOSAL_ERROR = 1002;
const NOT_ENOUGH_SPACE_FOR_PROPOSALS_ERROR = 1003;
const NOT_ENOUGH_REFS_GENERIC_PROPOSAL_ERROR = 1004;
const TOO_MANY_PROPOSALS_FROM_USER_ERROR = 1005;
const PROPOSAL_IS_NOT_COMPLETE_YET_ERROR = 1006;
const NON_ACTIVE_MEMBER_VOTING = 1007;
const DAO_NOT_INITED_ERROR = 1008;

const defaultConfig: DaoProposalsState = {
  owner_id: 100,
  proposals: new Map(),
  next_member_id: 0,
  active_members: {
    init: false,
    voted: new Set(),
  },
  sbt_item_code: new Cell(),
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

const defaultAddPrposal: ProposalAdd = {
  kind: "add",
  candidate: {
    bio: {
      length: 4,
      text: "test",
    },
    address: randomAddress().toString(),
    id: 2,
  },
  description: {
    length: 4,
    text: "test",
  },
};

const defaulRemoveProposal: ProposalRemove = {
  kind: "remove",
  candidate_id: 1,
  description: {
    length: 1,
    text: "1",
  },
};

const defaultGenericProposal: ProposalGeneric = {
  description: {
    length: 1,
    text: "t",
  },
  topic: {
    length: 1,
    text: "t",
  },
  kind: "generic",
};

const fullConfig: DaoProposalsState = {
  owner_id: 1,
  sbt_item_code: new Cell(),
  next_member_id: 0,
  active_members: {
    init: true,
    voted: new Set([0, 1, 2]),
  },
  proposals: new Map([[0, getProposal()]]),
};

function getProposal(
  state: Partial<ProposalState> = {},
  proposal: Proposal = getAddProposal()
): ProposalState {
  return {
    expiration_date: nowSeconds(),
    creator_id: 1,
    votes: [new Set(), new Set([1])],
    proposal: proposal,
    ...state,
  };
}

function getAddProposal(
  proposal: Partial<ProposalAdd> = {},
  candidate: Partial<Candidate> = defaultAddPrposal.candidate
): ProposalAdd {
  return {
    ...defaultAddPrposal,
    candidate: { ...defaultAddPrposal.candidate, ...candidate },
    ...proposal,
  };
}

function getRemoveProposal(
  proposal: Partial<ProposalRemove> = {}
): ProposalRemove {
  return { ...defaulRemoveProposal, ...proposal };
}

function getGenericProposal(
  proposal: Partial<ProposalGeneric> = {}
): ProposalGeneric {
  return { ...defaultGenericProposal, ...proposal };
}

async function getState(
  state: Partial<DaoProposalsState>
): Promise<DaoProposalsState> {
  const sbtItemCode = await compileFunc(SbtItemSource);
  return { ...fullConfig, ...{ sbt_item_code: sbtItemCode.cell }, ...state };
}

const OWNER_ADDRESS = randomAddress();

function expectStateEquality(
  first: DaoProposalsState,
  second: DaoProposalsState
) {
  expect(first.owner_id).toEqual(second.owner_id);
  expect(first.proposals).toEqual(second.proposals);
  expect(first.sbt_item_code.toString()).toEqual(
    second.sbt_item_code.toString()
  );
}

function expectSucess(result: any) {
  try {
    expect(result.type).toEqual("success");
    expect(result.exit_code).toEqual(0);
  } catch (e) {
    console.log(result.logs);
    throw e;
  }
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
    let dao = await DaoProposalsLocal.createFromConfig(
      await getState({
        owner_id: 10,
      })
    );
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
    let dao = await DaoProposalsLocal.createFromConfig(await getState({}));
    const response = await dao.sendWithProof(randomAddress(), 10, {
      kind: "check_proof",
    });
    expect(response.type).toEqual("success");
  });

  describe("|voting", () => {
    it("votes for existing proposal", async () => {
      const proposalId = 0;
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          active_members: {
            init: true,
            voted: new Set([10, 11]),
          },
        })
      );

      // check voting for
      let response = await dao.vote(randomAddress(), 10, proposalId, true);
      expectSucess(response);
      expect(await dao.countYayVotes(proposalId)).toEqual(2);

      // check voting against
      response = await dao.vote(randomAddress(), 11, proposalId, false);
      expectSucess(response);
      expect(await dao.countNayVotes(proposalId)).toEqual(1);

      // check double votes
      response = await dao.vote(randomAddress(), 10, proposalId, false);
      expect(response.type).toEqual("failed");
      expect(response.exit_code).toEqual(DOUBLE_VOTE_ERROR);
      expect(await dao.countNayVotes(proposalId)).toEqual(1);

      // check member voting not part of calibration vote
      response = await dao.vote(randomAddress(), 12, proposalId, false);
      expect(response.type).toEqual("failed");
      expect(response.exit_code).toEqual(NON_ACTIVE_MEMBER_VOTING);
    });

    it("votes for non-existing proposal", async () => {
      let dao = await DaoProposalsLocal.createFromConfig(await getState({}));
      const response = await dao.vote(randomAddress(), 10, 2, true);
      expect(response.type).toEqual("failed");
      expect(response.exit_code).toEqual(DICT_ERROR);
    });
  });

  describe("|select new proposal id", () => {
    const removeProposal: Proposal = getRemoveProposal();

    const removeProposalState: ProposalState = {
      expiration_date: nowSeconds(),
      creator_id: 10,
      proposal: removeProposal,
      votes: [new Set(), new Set()],
    };

    it("selects 0 for an empty dict", async () => {
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map(),
        })
      );
      const { result, id } = await dao.selectNewProposalId();
      expectSucess(result);
      expect(id).toEqual(0);
    });

    it("selects 2 because no proposals until 3", async () => {
      const proposals: Map<number, ProposalState> = new Map();
      proposals.set(3, removeProposalState);

      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals,
        })
      );
      const { result, id } = await dao.selectNewProposalId();
      expectSucess(result);
      expect(id).toEqual(2);
    });

    it("selects 2 because there is a gap between 1 and 3", async () => {
      const proposals: Map<number, ProposalState> = new Map();
      proposals.set(0, removeProposalState);
      proposals.set(1, removeProposalState);
      proposals.set(3, removeProposalState);

      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals,
        })
      );
      const { result, id } = await dao.selectNewProposalId();
      expectSucess(result);
      expect(id).toEqual(2);
    });

    it("selects 15 because there its the only free slot", async () => {
      const proposals: Map<number, ProposalState> = new Map();
      for (let i = 0; i < 15; i++) {
        proposals.set(i, removeProposalState);
      }
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals,
        })
      );
      const { result, id } = await dao.selectNewProposalId();
      expectSucess(result);
      expect(id).toEqual(15);
    });

    it("throws because there is no space for new proposal", async () => {
      const proposals: Map<number, ProposalState> = new Map();
      for (let i = 0; i < 16; i++) {
        proposals.set(i, removeProposalState);
      }
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals,
        })
      );
      const { result, id } = await dao.selectNewProposalId();
      expect(result.type).toEqual("failed");
      expect(result.exit_code).toEqual(NOT_ENOUGH_SPACE_FOR_PROPOSALS_ERROR);
    });
  });

  describe("|create proposals", () => {
    it("creates proposal before first calibration vote", async () => {
      const removeProposal: ProposalRemove = getRemoveProposal();
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map(),
          active_members: {
            init: false,
            voted: new Set(),
          },
        })
      );
      const result = await dao.createProposal(
        randomAddress(),
        10,
        nowSeconds(),
        removeProposal
      );
      expect(result.type).toEqual("failed");
      expect(result.exit_code).toEqual(DAO_NOT_INITED_ERROR);
    });
    it("creates add member proposal", async () => {
      const addProposal: ProposalAdd = getAddProposal({});
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map(),
        })
      );
      const expiration = nowSeconds();
      const result = await dao.createProposal(
        randomAddress(),
        10,
        nowSeconds(),
        addProposal
      );
      expectSucess(result);
      const proposal = await dao.getProposal(0);
      expect(proposal.proposal).toEqual(addProposal);
    });

    it("tries to create invalid add member proposal and fails", async () => {
      let dao = await DaoProposalsLocal.createFromConfig(await getState({}));
      const result = await dao.createProposal(
        randomAddress(),
        10,
        nowSeconds(),
        {
          kind: "add",
          description: {
            text: "1",
            length: 1,
          },
          candidate: {
            bio: {
              length: 1,
              text: "test",
            },
            id: 100,
          },
        } as any
      );
      expect(result.type).toEqual("failed");
    });

    it("creates remove member proposal", async () => {
      const removeProposal: ProposalRemove = getRemoveProposal();
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map(),
        })
      );
      const result = await dao.createProposal(
        randomAddress(),
        10,
        nowSeconds(),
        removeProposal
      );
      expectSucess(result);
      const proposal = await dao.getProposal(0);
      expect(proposal.proposal).toEqual(removeProposal);
    });

    it("tries to create incorrect remove member proposal and fails", async () => {
      const removeProposal: ProposalRemove = {
        candidate_id: 100,
        kind: "remove",
      } as any;
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map(),
        })
      );
      const result = await dao.createProposal(
        randomAddress(),
        10,
        nowSeconds(),
        removeProposal
      );
      expect(result.type).toEqual("failed");
    });

    it("creates generic proposal", async () => {
      const genericProposal: ProposalGeneric = getGenericProposal();
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map(),
        })
      );
      const result = await dao.createProposal(
        randomAddress(),
        10,
        nowSeconds(),
        genericProposal
      );

      expectSucess(result);
      const proposal = await dao.getProposal(0);
      expect(proposal.proposal).toEqual(genericProposal);
    });

    it("tries to create invalid generic proposal and fails", async () => {
      const genericProposal: ProposalGeneric = {
        description: {
          length: 1,
          text: "t",
        },
        kind: "generic",
      } as any;
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map(),
        })
      );
      const result = await dao.createProposal(
        randomAddress(),
        10,
        nowSeconds(),
        genericProposal
      );
      expect(result.type).toEqual("failed");
    });

    it("tries to create second proposal from the same member", async () => {
      const removeProposal: ProposalRemove = getRemoveProposal({
        candidate_id: 100,
      });
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map([
            [
              0,
              {
                expiration_date: nowSeconds(),
                creator_id: 1,
                proposal: removeProposal,
                votes: [new Set(), new Set()],
              },
            ],
          ]),
        })
      );
      const result = await dao.createProposal(
        randomAddress(),
        1,
        nowSeconds(),
        removeProposal
      );
      expect(result.type).toEqual("failed");
      expect(result.exit_code).toEqual(TOO_MANY_PROPOSALS_FROM_USER_ERROR);
    });

    it("creates calibration proposal", async () => {
      const expdate = nowSeconds();
      let dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map([]),
        })
      );
      let result = await dao.createProposal(randomAddress(), 1, expdate, {
        kind: "calibration",
      });
      expectSucess(result);
      const proposal = await dao.getProposal(0);
      expect(proposal).toEqual({
        expiration_date: expdate,
        creator_id: 1,
        proposal: { kind: "calibration" },
        votes: [new Set(), new Set()],
      });
    });
  });

  describe("|executes proposal decision", () => {
    it("checks that proposal exists", async () => {
      const dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map([]),
        })
      );
      const result = await dao.sendWithProof(randomAddress(), 10, {
        kind: "execute_decision",
        proposal_id: 0,
      });
      expect(result.type).toEqual("failed");
      expect(result.exit_code).toEqual(DICT_ERROR);
    });

    it("checks that proposal already expired", async () => {
      const dao = await DaoProposalsLocal.createFromConfig(
        await getState({
          proposals: new Map([
            [
              0,
              getProposal({
                creator_id: 1,
                expiration_date: nowSeconds() + 60 * 60 * 24,
                proposal: getRemoveProposal(),
              }),
            ],
          ]),
        })
      );
      const result = await dao.sendWithProof(randomAddress(), 10, {
        kind: "execute_decision",
        proposal_id: 0,
      });
      expect(result.type).toEqual("failed");
      expect(result.exit_code).toEqual(PROPOSAL_IS_NOT_COMPLETE_YET_ERROR);
    });
    describe("calibration proposal", () => {
      it("performs calibration", async () => {
        const dao = await DaoProposalsLocal.createFromConfig(
          await getState({
            active_members: {
              init: false,
              voted: new Set(),
            },
            proposals: new Map([
              [
                0,
                {
                  creator_id: 1,
                  expiration_date: nowSeconds() - 100,
                  proposal: {
                    kind: "calibration",
                  },
                  votes: [new Set([0, 1, 2, 4, 5, 6]), new Set([7, 8, 9])],
                },
              ],
            ]),
          })
        );
        const result = await dao.sendWithProof(randomAddress(), 10, {
          kind: "execute_decision",
          proposal_id: 0,
        });
        expectSucess(result);
        let state = await dao.getState();
        expect(state.active_members).toEqual({
          init: true,
          voted: new Set([0, 1, 2, 4, 5, 6, 7, 8, 9]),
        });
        expect(state.proposals.size).toEqual(0);
      });
    });
    describe("add members proposal", () => {
      [
        {
          name: "nobody votes",
          yay: [],
          nay: [],
        },
        {
          name: "not enough votes",
          nay: [],
          yay: [1],
        },
        {
          name: "equal votes",
          nay: [0, 1],
          yay: [2, 3],
        },
        {
          name: "minority votes",
          yay: [0],
          nay: [1, 2, 3],
        },
      ].forEach((param) => {
        it(`${param.name} ??? do not add`, async () => {
          const candidateAddress = randomAddress();
          const dao = await DaoProposalsLocal.createFromConfig(
            await getState({
              proposals: new Map([
                [
                  0,
                  {
                    creator_id: 1,
                    expiration_date: nowSeconds() - 1000,
                    proposal: getAddProposal(
                      {},
                      {
                        id: 100,
                        address: candidateAddress.toString(),
                      }
                    ),
                    votes: [new Set(param.nay), new Set(param.yay)],
                  },
                ],
              ]),
            })
          );
          const result = await dao.sendWithProof(randomAddress(), 10, {
            kind: "execute_decision",
            proposal_id: 0,
          });
          expectSucess(result);
          expect(result.actionList).toEqual([]);
          const state = await dao.getState();
          expect(state.proposals.size).toEqual(0);
        });
      });

      it("majority votes ??? do add", async () => {
        const candidateAddress = randomAddress();
        const dao = await DaoProposalsLocal.createFromConfig(
          await getState({
            proposals: new Map([
              [
                0,
                {
                  creator_id: 1,
                  expiration_date: nowSeconds() - 1000,
                  proposal: getAddProposal(
                    {},
                    {
                      id: 100,
                      address: candidateAddress.toString(),
                    }
                  ),
                  votes: [new Set([4, 5, 6]), new Set([0, 1, 2, 3])],
                },
              ],
            ]),
          })
        );
        const result = await dao.sendWithProof(randomAddress(), 10, {
          kind: "execute_decision",
          proposal_id: 0,
        });
        expectSucess(result);
        const state = await dao.getState();
        expect(state.proposals.size).toEqual(0);

        const mint = result.actionList[0] as SendMsgAction;
        const outMessage = unserializeSBTInit(mint.message.body.beginParse());
        const memberInfo = {
          bio: {
            text: "test",
            length: 4,
          },
          id: 100,
          inviter_id: 1,
          join_date: expect.any(Number),
        };
        const expectedMessage: SBTInit = {
          auth_address: dao.address.toString(),
          owner_address: candidateAddress.toString(),
          content: memberInfo,
        };
        expect(outMessage).toEqual(expectedMessage);
        // // intergrated check
        const content = beginCell();
        serializeMemberInfo(content, outMessage.content);
        const sbtInit = SbtQueries.init({
          auth_address: dao.address,
          owner_address: candidateAddress,
          content: content.endCell(),
        });
        expect(sbtInit.toDebugString()).toEqual(
          mint.message.body.toDebugString()
        );
      });
    });

    describe("remove members proposal", () => {
      [
        {
          name: "no quorum",
          members: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
          nay: [4, 5],
          yay: [0, 1, 2],
        },
        {
          name: "equal votes",
          members: [0, 1, 2, 3],
          nay: [0, 1],
          yay: [2, 3],
        },
        {
          name: "less votes for",
          members: [0, 1, 2, 3],
          nay: [0, 1],
          yay: [2],
        },
      ].forEach((params) => {
        it(`${params.name} ??? do not remove`, async () => {
          const dao = await DaoProposalsLocal.createFromConfig(
            await getState({
              active_members: {
                init: true,
                voted: new Set(params.members),
              },
              proposals: new Map([
                [
                  0,
                  {
                    creator_id: 1,
                    expiration_date: nowSeconds() - 1000,
                    proposal: getRemoveProposal(),
                    votes: [new Set(params.nay), new Set(params.yay)],
                  },
                ],
              ]),
            })
          );
          const result = await dao.sendWithProof(randomAddress(), 10, {
            kind: "execute_decision",
            proposal_id: 0,
          });
          expectSucess(result);
          expect(result.actionList).toEqual([]);
          const state = await dao.getState();
          expect(state.proposals.size).toEqual(0);
        });
      });

      it("quorum and more votes for ??? remove", async () => {
        const dao = await DaoProposalsLocal.createFromConfig(
          await getState({
            active_members: {
              init: true,
              voted: new Set([0, 1, 2, 3, 4, 5]),
            },
            proposals: new Map([
              [
                0,
                {
                  creator_id: 1,
                  expiration_date: nowSeconds() - 1000,
                  proposal: getRemoveProposal(),
                  votes: [new Set([0, 1]), new Set([2, 3, 4])],
                },
              ],
            ]),
          })
        );
        const result = await dao.sendWithProof(randomAddress(), 10, {
          kind: "execute_decision",
          proposal_id: 0,
        });
        expectSucess(result);
        const removeMessage = result.actionList[0] as SendMsgAction;
        const body = removeMessage.message.body.beginParse().readRef();
        const op = body.readUintNumber(32);
        expect(op).toEqual(OperationCodes.Destroy);
        expect(body.remaining).toEqual(0);
        expect(body.remainingRefs).toEqual(0);
        const state = await dao.getState();
        expect(state.proposals.size).toEqual(0);
      });
    });
  });
});
