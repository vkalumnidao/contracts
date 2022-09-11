import BN from "bn.js";
import {
  Cell,
  Slice,
  BitString,
  beginDict,
  beginCell,
  Builder,
  Address,
} from "ton";

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
  address: string;
};

export type MembedId = number;
const MEMBER_ID_BITS = 32;

export type ProposalAdd = {
  kind: "add";
  candidate: Candidate;
  description: Text;
};

export type ProposalRemove = {
  kind: "remove";
  candidate_id: MembedId;
  description: Text;
};

export type ProposalGeneric = {
  kind: "generic";
  topic: Text;
  description: Text;
};

function TLTag(length: number, value: number): BitString {
  const bit = BitString.alloc(length);
  bit.writeUint(value, length);
  return bit;
}

export type Proposal = ProposalAdd | ProposalGeneric | ProposalRemove;
const PORPOSAL_TAG_LENGTH = 4;
const PROPOSAL_ADD_TAG = TLTag(PORPOSAL_TAG_LENGTH, 1);
const PROPOSAL_REMOVE_TAG = TLTag(PORPOSAL_TAG_LENGTH, 2);
const PROPOSAL_GENERIC_TAG = TLTag(PORPOSAL_TAG_LENGTH, 3);

type MemberVotes = [Set<MembedId>, Set<MembedId>];

export type ProposalState = {
  creator_id: MembedId;
  proposal: Proposal;
  expiration_date: number;
  votes: MemberVotes;
};

const PROPOSAL_BITS = 4;
export type DaoProposalsState = {
  owner_id: number;
  sbt_item_code: Cell;
  nft_collection_address: string;
  proposals: Map<number, ProposalState>;
};

export type CastVote = {
  vote: boolean;
  proposal_id: number;
};

const IEVENT_TAG_LENGTH = 4;
const IEVENT_TAGS: Record<IEvent["kind"], BitString> = {
  check_proof: TLTag(IEVENT_TAG_LENGTH, 1),
  create_proposal: TLTag(IEVENT_TAG_LENGTH, 2),
  vote: TLTag(IEVENT_TAG_LENGTH, 3),
};

export type IEventCreateProposal = {
  kind: "create_proposal";
  expiration_date: number;
  body: Proposal;
};

export type IEventVote = {
  kind: "vote";
  cast_vote: CastVote;
};

export type IEvent =
  | IEventCreateProposal
  | IEventVote
  | { kind: "check_proof" };

type Proof<T> = {
  index: number;
  owner_address: string;
  body: T;
  with_content: boolean;
  content?: Cell;
};

type Event<T> = {
  body: Proof<T>;
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
  if (cn.address) {
    // this is needed for test to serialize incorrect data
    serializeAddress(builder, cn.address);
  }
  serializeText(builder, cn.bio);
}

function serializeAddress(builder: Builder, address: string) {
  builder.storeAddress(Address.parseRaw(address));
}

function unserializeAddress(parser: Slice): string {
  const address = parser.readAddress();
  if (!address) {
    throw new Error("Candidate without address");
  }

  return address.toString();
}

function unserializeCandidate(parser: Slice): Candidate {
  const id = parser.readUintNumber(MEMBER_ID_BITS);
  const address = unserializeAddress(parser);
  const bio = unserializeText(parser.readCell().beginParse());
  return {
    bio,
    address,
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
  if (remove.candidate_id) {
    builder.storeUint(remove.candidate_id, MEMBER_ID_BITS);
  }
  if (remove.description) {
    serializeText(builder, remove.description);
  }
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
  if (generic.topic) {
    // for tests
    serializeText(builder, generic.topic);
  }
  if (generic.description) {
    serializeText(builder, generic.description);
  }
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

export function unserializeProposal(parser: Slice): Proposal {
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
  const voted = new Set([...memberVotes[0], ...memberVotes[1]]);
  let votedString = new BN(0);
  voted.forEach((memberId) => {
    votedString = votedString.or(new BN(2).pow(new BN(memberId)));
  });
  let votedForString = new BN(0);
  memberVotes[1].forEach((memberId) => {
    votedForString = votedForString.or(new BN(2).pow(new BN(memberId)));
  });
  builder.storeUint(votedString, 256).storeUint(votedForString, 256);
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

function bitStringToMemberIds(bitstring: BN): Set<MembedId> {
  const indexes = new Set<MembedId>();
  let offset = 0;
  while (bitstring.gt(new BN(0))) {
    let zeros = bitstring.zeroBits();
    indexes.add(offset + zeros);
    offset += zeros + 1;
    bitstring = bitstring.shrn(zeros + 1);
  }
  return indexes;
}

export function unserializeMemberVotes(parser: Slice): MemberVotes {
  const votedString = parser.readUint(256);
  const votedForString = parser.readUint(256);
  const allVotes = bitStringToMemberIds(votedString);
  const votedFor = bitStringToMemberIds(votedForString);
  const votedAgainst = new Set([...allVotes].filter((v) => !votedFor.has(v)));
  return [votedAgainst, votedFor];
}

function serializeProposalState(
  builder: Builder,
  proposalState: ProposalState
) {
  builder.storeUint(proposalState.creator_id, MEMBER_ID_BITS);
  serializeTime(builder, proposalState.expiration_date);
  const votes = beginCell();
  serializeMemberVotes(votes, proposalState.votes);
  builder.storeRef(votes.endCell());
  const propCell = beginCell();
  serializeProposal(propCell, proposalState.proposal);
  builder.storeRef(propCell.endCell());
}

export function unserializeProposalState(parser: Slice): ProposalState {
  const creatorId = parser.readUintNumber(MEMBER_ID_BITS);
  const expiration = unserializeTime(parser);
  const votes = unserializeMemberVotes(parser.readRef());
  const proposal = unserializeProposal(parser.readRef());
  return {
    creator_id: creatorId,
    expiration_date: expiration,
    votes,
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
  const builder = beginCell()
    .storeUint(state.owner_id, MEMBER_ID_BITS)
    .storeRef(state.sbt_item_code);
  serializeAddress(builder, state.nft_collection_address);
  return builder.storeDict(dict.endDict()).endCell();
}

export function unserializeDaoProposalsState(parser: Slice): DaoProposalsState {
  const owner = parser.readUintNumber(MEMBER_ID_BITS);
  const code = parser.readCell();
  const address = unserializeAddress(parser);
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
    nft_collection_address: address,
    sbt_item_code: code,
  };
}

export function serializeCastVote(builder: Builder, cast: CastVote) {
  builder.storeBit(cast.vote);
  builder.storeUint(cast.proposal_id, PROPOSAL_BITS);
}

export function serializeIEvent(builder: Builder, event: IEvent) {
  const tag = IEVENT_TAGS[event.kind];
  if (!tag) {
    throw new Error(`Tag for ${event.kind} is not defined`);
  }
  builder.storeBitString(tag);
  switch (event.kind) {
    case "create_proposal":
      serializeTime(builder, event.expiration_date);
      const pcell = beginCell();
      serializeProposal(pcell, event.body);
      builder.storeRef(pcell.endCell());
      break;
    case "vote":
      serializeCastVote(builder, event.cast_vote);
      break;
    case "check_proof":
      builder.storeRef(new Cell());
      break;
    default:
      never(event, "Unknown event " + event);
  }
}

export function serializeProof<T>(
  builder: Builder,
  proof: Proof<T>,
  serializer: (b: Builder, d: T) => void
) {
  builder.storeUint(proof.index, 256);
  serializeAddress(builder, proof.owner_address);
  const bodyCell = beginCell();
  serializer(bodyCell, proof.body);
  builder.storeRef(bodyCell.endCell()).storeBit(proof.with_content);
  if (proof.with_content && proof.content) {
    builder.storeRef(proof.content);
  }
}
