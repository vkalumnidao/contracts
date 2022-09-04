import { combineFunc } from "../utils/combineFunc";

export const DaoProposalsSource = combineFunc(__dirname, [
  "../../src/stdlib.fc",
  "../../src/op-codes.fc",
  "../../src/params.fc",
  "../../src/dao-proposals.fc",
]);
