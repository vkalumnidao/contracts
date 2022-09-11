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
} from "./DaoProposals.data";
import { SbtItemSource } from "../sbt-item/SbtItem.source";

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
}
