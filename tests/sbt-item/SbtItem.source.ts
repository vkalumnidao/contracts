import { combineFunc } from "../utils/combineFunc";

export const SbtItemSource = combineFunc(__dirname, [
  "../../src/stdlib.fc",
  "../../src/op-codes.fc",
  "../../src/params.fc",
  "../../src/sbt-item.fc",
]);
