import { SmartContract } from "ton-contract-executor";
import { compileFunc } from "../utils/compileFunc";
import { DaoProposalsSource } from "./DaoProposals.source";
import { Address, contractAddress } from "ton";
import { DaoProposalsData, buildDaoProposalsCells } from "./DaoProposals.data";

export class DaoProposalsLocal {
  private constructor(
    public readonly contract: SmartContract,
    public readonly address: Address
  ) {}

  static async createFromConfig(config: DaoProposalsData) {
    let code = await compileFunc(DaoProposalsSource);

    let data = buildDaoProposalsCells(config);
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

    return new DaoProposalsLocal(contract, address);
  }
}
