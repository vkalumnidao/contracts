import { SmartContract } from "ton-contract-executor";
import { compileFunc } from "../utils/compileFunc";
import { DaoProposalsSource } from "./DaoProposals.source";
import {
  Address,
  beginCell,
  Cell,
  CellMessage,
  CommonMessageInfo,
  contractAddress,
  InternalMessage,
  Slice,
  toNano,
} from "ton";
import {
  DaoProposalsState,
  IEvent,
  serializeDaoProposalsState,
  serializeIEvent,
  serializeProof,
  unserializeDaoProposalsState,
} from "./DaoProposals.data";
import { SbtItemSource } from "../sbt-item/SbtItem.source";
import BN from "bn.js";
import { randomAddress } from "../utils/randomAddress";

const cellToBoc = (cell: Cell) => {
  return cell.toBoc({ idx: false }).toString("base64");
};

export class DaoProposalsLocal {
  private constructor(
    public readonly initState: DaoProposalsState,
    public readonly contract: SmartContract,
    public readonly address: Address
  ) {}

  static async createFromConfig(config: DaoProposalsState) {
    let code = await compileFunc(DaoProposalsSource);

    let data = serializeDaoProposalsState(config);
    let contract = await SmartContract.fromCell(code.cell, data, {
      debug: true,
    });

    let address = contractAddress({
      workchain: 0,
      initialData: contract.dataCell,
      initialCode: contract.codeCell,
    });

    contract.setC7Config({
      myself: address,
    });

    return new DaoProposalsLocal(config, contract, address);
  }

  async sendWithProof(ownerAddress: Address, memberId: number, event: IEvent) {
    const expected_address_t = await this.contract.invokeGetMethod(
      "calculate_nft_item_address_init",
      [
        {
          type: "int",
          value: memberId.toString(),
        },
        {
          type: "cell",
          value: cellToBoc(this.initState.sbt_item_code),
        },
        {
          type: "cell_slice",
          value: cellToBoc(
            beginCell()
              .storeAddress(this.initState.nft_collection_address)
              .endCell()
          ),
        },
      ]
    );

    const bodyCell = beginCell();
    serializeProof(
      bodyCell,
      {
        body: event,
        index: memberId,
        owner_address: ownerAddress,
        with_content: false,
      },
      serializeIEvent
    );
    const expected_address = (
      expected_address_t.result[0] as Slice
    ).readAddress();
    return this.contract.sendInternalMessage(
      new InternalMessage({
        to: this.address,
        body: new CommonMessageInfo({
          body: new CellMessage(bodyCell.endCell()),
        }),
        bounce: false,
        from: expected_address,
        value: toNano(1),
      })
    );
  }

  async getState(): Promise<DaoProposalsState> {
    const state = await this.contract.invokeGetMethod("storage_get_state", []);
    if (state.type === "failed") {
      console.log(state);
      throw new Error("Unable to count votes");
    }

    const sateSlice = state.result[0] as Slice;

    return unserializeDaoProposalsState(sateSlice);
  }

  async countYayVotes(poposalId: number): Promise<number> {
    const vote_count = await this.contract.invokeGetMethod(
      "storage_count_proposal_yays",
      [
        {
          type: "int",
          value: poposalId.toString(),
        },
      ]
    );
    if (vote_count.type === "failed") {
      console.log(vote_count);
      throw new Error("Unable to count votes");
    }

    const count = vote_count.result[0] as BN;
    return count.toNumber();
  }

  async vote(
    owner_address: Address,
    member_id: number,
    proposal_id: number,
    vote: boolean
  ) {
    return this.sendWithProof(owner_address, member_id, {
      kind: "vote",
      cast_vote: {
        proposal_id,
        vote,
      },
    });
  }

  async countNayVotes(poposalId: number): Promise<number> {
    const vote_count = await this.contract.invokeGetMethod(
      "storage_count_proposal_nays",
      [
        {
          type: "int",
          value: poposalId.toString(),
        },
      ]
    );
    if (vote_count.type === "failed") {
      console.log(vote_count);
      throw new Error("Unable to count votes");
    }

    const count = vote_count.result[0] as BN;
    return count.toNumber();
  }
}
