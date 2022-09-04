import { Cell } from "ton";

export type DaoProposalsData = {
  index: number;
};

export function buildDaoProposalsCells(data: DaoProposalsData): Cell {
  let dataCell = new Cell();
  dataCell.bits.writeUint(data.index, 64);
  return dataCell;
}
