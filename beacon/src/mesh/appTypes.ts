// Shared contract for the mesh-carried app features (road status, family breadcrumbs, shake consensus).
// The mesh core (packet.ts, node.ts, services/mesh.ts) implements the transport side; feature code builds on these shapes.

/** What a person saw on a road. 'clear' withdraws an earlier report. */
export type RoadStatus = 'blocked' | 'flooded' | 'damaged' | 'crowded' | 'clear';

export interface RoadReport {
  /** random 8 hex chars, unique per report */
  id: string;
  status: RoadStatus;
  lat: number;
  lon: number;
  /** a few words, max 120 characters */
  note?: string;
  /** when it was seen (ms) */
  seenAt: number;
}

/** A phone that was within Bluetooth range of the reporter and near the reported spot signed that it saw the report. */
export interface RoadAttestation {
  reportId: string;
  /** attester's signing public key, hex */
  by: string;
  /** when (ms) */
  at: number;
}

/** A road report as the app receives it. */
export interface RoadEvent {
  report: RoadReport;
  /** reporter's mesh peer id, hex */
  from: string;
  /** distinct attesters seen so far (the reporter is not counted) */
  attesters: number;
  verified: boolean;
  hops: number;
  receivedAt: number;
}

/**
 * An opaque, end-to-end encrypted note that rides the mesh. The mesh never reads it. The app seals it with the family key
 * so only family members can open it; `tag` lets a family phone recognise its own family's notes cheaply.
 */
export interface OpaqueNote {
  /** 8 bytes as 16 hex chars: HMAC(familyKey, day) truncated, so a note can be matched without decrypting */
  tag: string;
  /** base64 of nonce(12) || ChaCha20-Poly1305 ciphertext || tag(16) */
  blob: string;
  from: string;
  /** packet timestamp (ms) */
  timestamp: number;
  hops: number;
}

/** What a family breadcrumb says once opened (app level, inside the sealed blob). Max about 200 bytes. */
export interface Breadcrumb {
  /** member name or member id of whoever left it */
  who: string;
  lat: number;
  lon: number;
  /** accuracy in metres, when known */
  acc?: number;
  /** battery 0-100, when known */
  batt?: number;
  /** when (ms) */
  at: number;
  /** a free note such as 'at the school gate' (max 80 chars) */
  note?: string;
}

/** One phone's report that it felt strong shaking. Votes from several nearby phones within seconds mean an earthquake. */
export interface ShakeVote {
  /** sender-chosen random id so a repeated vote is counted once */
  id: string;
  lat: number;
  lon: number;
  /** peak ground acceleration seen, in milli-g (1000 = 1 g) */
  peakMg: number;
  /** when shaking started (ms) */
  startedAt: number;
}

export interface ShakeEvent {
  vote: ShakeVote;
  from: string;
  hops: number;
  receivedAt: number;
}

/** What the phone concluded from the votes. */
export interface ShakeVerdict {
  confirmed: boolean;
  /** distinct phones that voted within the window, including this one */
  phones: number;
  /** strongest peak among them (milli-g) */
  peakMg: number;
  /** first vote time (ms) */
  firstAt: number;
}
