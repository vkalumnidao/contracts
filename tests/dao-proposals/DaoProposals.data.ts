import { Cell, Slice, BitString, beginDict, beginCell, Builder } from "ton";

export function never(_: never, msg: string): never {
  throw new Error(`never: ${msg}`);
}

type Text = {
  text: string;
  length: number;
};
type Candidate = {
  id: number;
  bio: Text;
};

type MembedId = number;
const MEMBER_ID_BITS = 32;

type ProposalAdd = {
  kind: "add";
  candidate: Candidate;
  description: Text;
};

type ProposalRemove = {
  kind: "remove";
  candidate_id: MembedId;
  description: Text;
};

type ProposalGeneric = {
  kind: "generic";
  topic: Text;
  description: Text;
};

function TLTag(length: number, value: number): BitString {
  const bit = BitString.alloc(length);
  bit.writeUint(value, length);
  return bit;
}

type Proposal = ProposalAdd | ProposalGeneric | ProposalRemove;
const PORPOSAL_TAG_LENGTH = 4;
const PROPOSAL_ADD_TAG = TLTag(PORPOSAL_TAG_LENGTH, 1);
const PROPOSAL_REMOVE_TAG = TLTag(PORPOSAL_TAG_LENGTH, 2);
const PROPOSAL_GENERIC_TAG = TLTag(PORPOSAL_TAG_LENGTH, 3);

type MemberVotes = Map<number, true>;

type ProposalState = {
  proposal: Proposal;
  expiration_date: number;
  yay: MemberVotes;
  nay: MemberVotes;
};

const PROPOSAL_BITS = 3;
export type DaoProposalsState = {
  owner_id: number;
  proposals: Map<number, ProposalState>;
};

function serializeText(builder: Builder, text: Text) {
  builder.storeRef(
    beginCell()
      .storeUint8(text.length)
      .storeBuffer(Buffer.from(text.text))
      .endCell()
  );
}

function unserializeText(parser: Slice): Text {
  const len = parser.readUintNumber(8);
  const text = parser.readBuffer(len).toString();
  return {
    length: len,
    text,
  };
}

function serializeCandidate(builder: Builder, cn: Candidate) {
  builder.storeUint(cn.id, MEMBER_ID_BITS);
  serializeText(builder, cn.bio);
}

function unserializeCandidate(parser: Slice): Candidate {
  const id = parser.readUintNumber(MEMBER_ID_BITS);
  const bio = unserializeText(parser.readCell().beginParse());
  return {
    bio,
    id,
  };
}

function serializeProposalAdd(builder: Builder, add: ProposalAdd) {
  serializeCandidate(builder, add.candidate);
  serializeText(builder, add.description);
}

function unserializeProposalAdd(parser: Slice): ProposalAdd {
  const candidate = unserializeCandidate(parser);
  const description = unserializeText(parser.readCell().beginParse());
  return {
    candidate,
    description,
    kind: "add",
  };
}

function serializeProposalRemove(builder: Builder, remove: ProposalRemove) {
  builder.storeUint(remove.candidate_id, MEMBER_ID_BITS);
  serializeText(builder, remove.description);
}

function unserializeProposalRemove(parser: Slice): ProposalRemove {
  const candidateId = parser.readUintNumber(MEMBER_ID_BITS);
  const description = unserializeText(parser.readCell().beginParse());
  return {
    candidate_id: candidateId,
    description,
    kind: "remove",
  };
}

function serializeProposalGeneric(builder: Builder, generic: ProposalGeneric) {
  serializeText(builder, generic.topic);
  serializeText(builder, generic.description);
}

function unserializeProposalGeneric(parser: Slice): ProposalGeneric {
  const topic = unserializeText(parser.readCell().beginParse());
  const description = unserializeText(parser.readCell().beginParse());
  return {
    description,
    topic,
    kind: "generic",
  };
}

function serializeProposal(builder: Builder, proposal: Proposal) {
  switch (proposal.kind) {
    case "add":
      builder.storeBitString(PROPOSAL_ADD_TAG);
      serializeProposalAdd(builder, proposal);
      break;
    case "remove":
      builder.storeBitString(PROPOSAL_REMOVE_TAG);
      serializeProposalRemove(builder, proposal);
      break;
    case "generic":
      builder.storeBitString(PROPOSAL_GENERIC_TAG);
      serializeProposalGeneric(builder, proposal);
      break;
    default:
      never(proposal, "Unexpected proposal type: " + proposal);
  }
}

function unserializeProposal(parser: Slice): Proposal {
  const tag = parser.readBitString(PORPOSAL_TAG_LENGTH);
  // equals method doesnt work, because for some reason readBitString create bitstring of 1023 length
  if (tag.toString() === PROPOSAL_ADD_TAG.toString()) {
    return unserializeProposalAdd(parser);
  }
  if (tag.toString() === PROPOSAL_REMOVE_TAG.toString()) {
    return unserializeProposalRemove(parser);
  }
  if (tag.toString() === PROPOSAL_GENERIC_TAG.toString()) {
    return unserializeProposalGeneric(parser);
  }
  throw new Error("Unknonw proposal type tag: " + tag.toString());
}

function serializeTime(builder: Builder, ts: number) {
  builder.storeUint(ts, 64);
}

function unserializeTime(parser: Slice): number {
  return parser.readUintNumber(64);
}

function serializeMemberVotes(builder: Builder, memberVotes: MemberVotes) {
  const dictBuilder = beginDict(MEMBER_ID_BITS);
  memberVotes.forEach((_, key) => {
    dictBuilder.storeCell(key, new Cell());
  });
  builder.storeDict(dictBuilder.endDict());
}

function unserializeDict<T>(
  dictSize: number,
  parser: Slice,
  interpreter: (slice: Slice) => T
): Map<string, T> {
  if (!parser.readBit()) {
    return new Map();
  } else {
    return parser.readDict(dictSize, interpreter);
  }
}

function unserializeMemberVotes(parser: Slice): MemberVotes {
  const dict = unserializeDict(MEMBER_ID_BITS, parser, () => {
    return true;
  });
  const votes: MemberVotes = new Map();
  for (let [key, _] of dict) {
    votes.set(parseInt(key), true);
  }
  return votes;
}

function serializeProposalState(
  builder: Builder,
  proposalState: ProposalState
) {
  serializeTime(builder, proposalState.expiration_date);
  serializeMemberVotes(builder, proposalState.yay);
  serializeMemberVotes(builder, proposalState.nay);
  const propCell = beginCell();
  serializeProposal(propCell, proposalState.proposal);
  builder.storeRef(propCell.endCell());
}

function unserializeProposalState(parser: Slice): ProposalState {
  const expiration = unserializeTime(parser);
  const yay = unserializeMemberVotes(parser);
  const nay = unserializeMemberVotes(parser);
  const proposal = unserializeProposal(parser.readRef());
  return {
    expiration_date: expiration,
    yay,
    nay,
    proposal,
  };
}

export function serializeDaoProposalsState(state: DaoProposalsState): Cell {
  const dict = beginDict(PROPOSAL_BITS);
  state.proposals.forEach((proposal, id) => {
    const builder = beginCell();
    serializeProposalState(builder, proposal);
    dict.storeCell(id, builder.endCell());
  });
  return beginCell()
    .storeUint(state.owner_id, MEMBER_ID_BITS)
    .storeDict(dict.endDict())
    .endCell();
}

export function unserializeDaoProposalsState(parser: Slice): DaoProposalsState {
  const owner = parser.readUintNumber(MEMBER_ID_BITS);
  const proposalsStr = unserializeDict(PROPOSAL_BITS, parser, (slice) => {
    return unserializeProposalState(slice);
  });
  const proposals: Map<number, ProposalState> = new Map();
  for (let [key, val] of proposalsStr) {
    proposals.set(parseInt(key), val);
  }
  return {
    owner_id: owner,
    proposals,
  };
}
