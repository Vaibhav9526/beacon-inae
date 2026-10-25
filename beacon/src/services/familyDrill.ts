/**
 * Family drills over the mesh public chat. Pure logic only: no react-native imports, so it runs under `tsx --test`.
 *
 * A drill travels as an ordinary public chat message whose text is `BCN-DRILL1:` + compact JSON.
 * Every phone in range sees the same messages, so every phone can rebuild the same state by replaying them.
 */
import type { T } from '../kb/types';

export const PREFIX = 'BCN-DRILL1:';
export const MAX_CHARS = 400;

/** Time each prompt stays on screen before it counts as "no answer". */
export const PROMPT_MS = 20_000;
/** Answers within this many ms get the full speed bonus. */
export const FAST_MS = 5_000;
export const BEST_POINTS = 100;
export const OK_POINTS = 50;
export const SPEED_MAX = 50;
/** After a player finishes, how long to wait for the host's `end` before showing the scoreboard anyway. */
export const END_GRACE_MS = 30_000;
/** Incoming drill starts older than this are not offered as a join banner. */
export const JOIN_WINDOW_MS = 10 * 60_000;

export const SCENARIO_IDS = ['earthquake', 'flood', 'fire', 'cyclone', 'heatwave'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export type Grade = 'best' | 'ok' | 'wrong';

export interface Choice {
  /** `<promptIndex><letter>`, e.g. `0a`, `2c`. Unique across a scenario, so it also says which prompt it answers. */
  id: string;
  label: T;
  grade: Grade;
}

export interface Prompt {
  question: T;
  /** Shown after the choice. The best answer is praised; any other answer gets "Better: <best label>" plus this line. */
  why: T;
  choices: Choice[];
}

export interface Scenario {
  id: ScenarioId;
  title: T;
  prompts: Prompt[];
}

export type DrillMsg =
  | { t: 'start'; id: string; scenario: ScenarioId; startedAt: number; by: string }
  | { t: 'answer'; id: string; who: string; choiceId: string; atMs: number }
  | { t: 'end'; id: string };

// ---- content ------------------------------------------------------------------------------

type Def = { q: T; why: T; a: [T, Grade]; b: [T, Grade]; c: [T, Grade] };

function build(id: ScenarioId, title: T, defs: Def[]): Scenario {
  return {
    id,
    title,
    prompts: defs.map((d, k) => ({
      question: d.q,
      why: d.why,
      choices: (['a', 'b', 'c'] as const).map((letter, i) => {
        const [label, grade] = [d.a, d.b, d.c][i];
        return { id: `${k}${letter}`, label, grade };
      }),
    })),
  };
}

const SCENARIOS: Record<ScenarioId, Scenario> = {
  earthquake: build('earthquake', ['7.0 earthquake at 2 am', 'रात 2 बजे 7.0 का भूकंप'], [
    {
      q: ['The shaking starts at 2 am. What do you do first?', 'रात 2 बजे झटके शुरू हुए। सबसे पहले क्या करोगे?'],
      why: ['Drop, Cover, Hold On. Running in the dark causes falls and injuries.', 'झुको, ढको, पकड़ो। अंधेरे में भागने से गिरकर चोट लग सकती है।'],
      a: [['Drop to the floor, cover your head and neck', 'नीचे झुको, सिर और गर्दन ढको'], 'best'],
      b: [['Hold on where you are and stay low', 'जहाँ हो वहीं पकड़कर नीचे बैठो'], 'ok'],
      c: [['Run outside in the dark', 'अंधेरे में बाहर भागो'], 'wrong'],
    },
    {
      q: ['The lights go out. Where do you wait for the shaking to stop?', 'बिजली चली गई। झटके रुकने तक कहाँ रहोगे?'],
      why: ['A sturdy table or bed protects you from falling things. Glass can break.', 'मज़बूत मेज़ या पलंग गिरती चीज़ों से बचाता है। काँच टूट सकता है।'],
      a: [['Under a strong table or bed', 'मज़बूत मेज़ या पलंग के नीचे'], 'best'],
      b: [['Against an inside wall, away from glass', 'अंदरूनी दीवार के पास, काँच से दूर'], 'ok'],
      c: [['Next to the window', 'खिड़की के पास'], 'wrong'],
    },
    {
      q: ['The shaking stops. What do you check first?', 'झटके रुक गए। सबसे पहले क्या देखोगे?'],
      why: ['Check people for injuries first. Then look for gas smell and fire.', 'पहले लोगों की चोट देखो। फिर गैस की गंध और आग देखो।'],
      a: [['Yourself and family for injuries', 'खुद और परिवार की चोट'], 'best'],
      b: [['Send a message to family that you are okay', 'परिवार को संदेश भेजो कि ठीक हो'], 'ok'],
      c: [['Take the lift down to the car', 'लिफ़्ट से नीचे गाड़ी तक जाओ'], 'wrong'],
    },
    {
      q: ['Aftershocks may come. Where do you wait?', 'झटके फिर आ सकते हैं। कहाँ इंतज़ार करोगे?'],
      why: ['Damaged buildings can fall in an aftershock. Stay outdoors, away from walls and wires.', 'टूटी इमारत आफ़्टरशॉक में गिर सकती है। बाहर, दीवारों और तारों से दूर रहो।'],
      a: [['Open space away from buildings and wires', 'इमारतों और तारों से दूर खुली जगह'], 'best'],
      b: [['Inside, away from windows and furniture', 'अंदर, खिड़कियों और फ़र्नीचर से दूर'], 'ok'],
      c: [['Near the walls of a cracked building', 'दरार वाली इमारत की दीवारों के पास'], 'wrong'],
    },
  ]),

  flood: build('flood', ['Flood warning', 'बाढ़ की चेतावनी'], [
    {
      q: ['A flood warning comes on the phone. What do you do first?', 'फ़ोन पर बाढ़ की चेतावनी आई। सबसे पहले क्या करोगे?'],
      why: ['Warnings give you time. Leave early for high ground with your family.', 'चेतावनी से समय मिलता है। परिवार के साथ जल्दी ऊँची जगह निकलो।'],
      a: [['Gather family and go to higher ground now', 'परिवार को इकट्ठा करके अभी ऊँची जगह जाओ'], 'best'],
      b: [['Pack documents and medicines first', 'पहले कागज़ात और दवाइयाँ बाँधो'], 'ok'],
      c: [['Wait to see if the water really comes', 'देखने के लिए रुको कि पानी आता है या नहीं'], 'wrong'],
    },
    {
      q: ['Water is coming into the street. Can you walk through it?', 'गली में पानी आ रहा है। क्या उसमें चल सकते हो?'],
      why: ['About 15 cm of moving water can knock you down. Holes and wires may be hidden.', 'बहते पानी में 15 सेमी भी गिरा सकता है। गड्ढे और तार छिपे हो सकते हैं।'],
      a: [['Never. Moving water is strong and dirty', 'कभी नहीं। बहता पानी तेज़ और गंदा है'], 'best'],
      b: [['Walk on the high edge of the road, away from the current', 'सड़क के ऊँचे किनारे, धारा से दूर चलो'], 'ok'],
      c: [['Yes, if it is only ankle deep', 'हाँ, अगर सिर्फ़ टखने तक है'], 'wrong'],
    },
    {
      q: ['You need drinking water. What is safe?', 'पीने के लिए पानी चाहिए। क्या सुरक्षित है?'],
      why: ['Flood water mixes with sewage. Boil water or use sealed bottled water.', 'बाढ़ के पानी में गंदगी मिली होती है। पानी उबालो या सीलबंद बोतल का लो।'],
      a: [['Boiled or sealed bottled water', 'उबला हुआ या सीलबंद बोतल का पानी'], 'best'],
      b: [['Rainwater from a covered tank, boiled', 'ढके टैंक का बारिश का पानी, उबालकर'], 'ok'],
      c: [['Floodwater, after it settles', 'बाढ़ का पानी, थोड़ी देर रखने के बाद'], 'wrong'],
    },
    {
      q: ['Power wires are in the water near you. What do you do?', 'पानी में बिजली के तार हैं। क्या करोगे?'],
      why: ['Water carries electricity. Stay far away and report it to the electricity office.', 'पानी बिजली चलाता है। दूर रहो और बिजली दफ़्तर को बताओ।'],
      a: [['Stay away from the water and do not touch switches', 'पानी से दूर रहो और स्विच न छुओ'], 'best'],
      b: [['Switch off the main supply from a dry spot', 'सूखी जगह से मेन स्विच बंद करो'], 'ok'],
      c: [['Touch the wire with a stick to move it', 'तार को डंडे से हटाने की कोशिश करो'], 'wrong'],
    },
  ]),

  fire: build('fire', ['Fire in the kitchen', 'रसोई में आग'], [
    {
      q: ['Oil catches fire in the kitchen pan. What do you do?', 'रसोई की कड़ाही में तेल में आग लग गई। क्या करोगे?'],
      why: ['Water spreads an oil fire. Turn off the gas and cover the pan with a lid.', 'पानी तेल की आग फैलाता है। गैस बंद करो और कड़ाही को ढक्कन से ढको।'],
      a: [['Turn off the gas and cover the pan with a lid', 'गैस बंद करो और कड़ाही पर ढक्कन रखो'], 'best'],
      b: [['Shout for help and step back from the stove', 'मदद के लिए आवाज़ दो और चूल्हे से पीछे हटो'], 'ok'],
      c: [['Pour water on it', 'उस पर पानी डालो'], 'wrong'],
    },
    {
      q: ['Smoke fills the kitchen. How do you move?', 'रसोई में धुआँ भर गया। कैसे निकलोगे?'],
      why: ['Smoke rises, so the air near the floor is cleaner. Cover your nose.', 'धुआँ ऊपर उठता है, फ़र्श के पास हवा साफ़ रहती है। नाक ढको।'],
      a: [['Low to the floor, nose covered with a wet cloth', 'नीचे झुककर, नाक गीले कपड़े से ढककर'], 'best'],
      b: [['Crouch and crawl, nose covered with a dry cloth', 'झुककर रेंगते हुए, नाक सूखे कपड़े से ढककर'], 'ok'],
      c: [['Stand tall and run through', 'सीधे खड़े होकर भागते हुए'], 'wrong'],
    },
    {
      q: ['The door feels hot. What now?', 'दरवाज़ा छूने पर गर्म है। अब क्या?'],
      why: ['A hot door means fire on the other side. Never open it.', 'गर्म दरवाज़ा यानी दूसरी तरफ़ आग है। उसे कभी न खोलो।'],
      a: [['Do not open it. Use another exit or a window and call for help', 'मत खोलो। दूसरा रास्ता या खिड़की लो और मदद बुलाओ'], 'best'],
      b: [['Close it tightly, stay in the room and call 101', 'कसकर बंद करो, कमरे में रहो और 101 पर फ़ोन करो'], 'ok'],
      c: [['Open it a little to look', 'देखने के लिए थोड़ा खोलो'], 'wrong'],
    },
    {
      q: ['Your sleeve catches fire. What do you do?', 'आस्तीन में आग लग गई। क्या करोगे?'],
      why: ['Running feeds the fire. Stop, drop, cover your face and roll.', 'दौड़ने से आग बढ़ती है। रुको, लेटो, चेहरा ढको और लुढ़को।'],
      a: [['Stop, drop and roll', 'रुको, लेटो और लुढ़को'], 'best'],
      b: [['Smother it with a blanket or wet cloth', 'कंबल या गीले कपड़े से दबाओ'], 'ok'],
      c: [['Run around to get air', 'हवा के लिए इधर-उधर दौड़ो'], 'wrong'],
    },
  ]),

  cyclone: build('cyclone', ['Cyclone warning', 'चक्रवात की चेतावनी'], [
    {
      q: ['A cyclone warning is issued. What do you do first?', 'चक्रवात की चेतावनी जारी हुई है। सबसे पहले क्या करोगे?'],
      why: ['Follow official orders early. Charge phones and store water while there is time.', 'सरकारी आदेश जल्दी मानो। समय रहते फ़ोन चार्ज करो और पानी जमा करो।'],
      a: [['Follow official orders and move to the shelter named', 'सरकारी आदेश मानो और बताए गए आश्रय में जाओ'], 'best'],
      b: [['Charge phones and fill water containers', 'फ़ोन चार्ज करो और पानी भरो'], 'ok'],
      c: [['Go to the beach to see the waves', 'लहरें देखने समुद्र तट जाओ'], 'wrong'],
    },
    {
      q: ['Strong winds start. Where do you stay?', 'तेज़ हवा शुरू हुई। कहाँ रहोगे?'],
      why: ['Wind breaks glass and throws things. Stay in an inner room, away from windows.', 'हवा काँच तोड़ती है और चीज़ें उड़ाती है। खिड़की से दूर, अंदरूनी कमरे में रहो।'],
      a: [['An inner room away from windows', 'खिड़कियों से दूर अंदरूनी कमरे में'], 'best'],
      b: [['Ground floor, with doors closed and taped', 'निचली मंज़िल पर, दरवाज़े बंद करके'], 'ok'],
      c: [['On the roof to watch the storm', 'तूफ़ान देखने छत पर'], 'wrong'],
    },
    {
      q: ['The wind suddenly stops. Its the calm eye of the storm. What do you do?', 'अचानक हवा रुक गई। यह तूफ़ान की शांत आँख है। क्या करोगे?'],
      why: ['The calm is the eye. Strong winds return from the other side of the storm.', 'यह शांति तूफ़ान की आँख है। दूसरी तरफ़ से तेज़ हवा फिर लौटती है।'],
      a: [['Stay inside. The wind will come back hard', 'अंदर रहो। हवा फिर तेज़ लौटेगी'], 'best'],
      b: [['Stay indoors and check water and food', 'अंदर रहो और पानी व खाना देखो'], 'ok'],
      c: [['Go outside to check the damage', 'नुकसान देखने बाहर जाओ'], 'wrong'],
    },
  ]),

  heatwave: build('heatwave', ['Heatwave at noon', 'दोपहर में लू'], [
    {
      q: ['It is noon and very hot. What do you do?', 'दोपहर है और बहुत गर्मी है। क्या करोगे?'],
      why: ['Avoid the sun from noon to 4 pm. Drink water even if you are not thirsty.', 'दोपहर 12 से 4 बजे धूप से बचो। प्यास न लगे तब भी पानी पियो।'],
      a: [['Stay in shade or a cool room and sip water often', 'छाँव या ठंडे कमरे में रहो और बार-बार पानी पियो'], 'best'],
      b: [['Rest in a room with a fan and drink water', 'पंखे वाले कमरे में आराम करो और पानी पियो'], 'ok'],
      c: [['Work outdoors without a break', 'बिना आराम के धूप में काम करो'], 'wrong'],
    },
    {
      q: ['Someone feels dizzy, confused and very hot. What do you do?', 'किसी को चक्कर, उलझन और बहुत गर्मी लग रही है। क्या करोगे?'],
      why: ['Dizziness and confusion can mean heatstroke. Cool them fast and get medical help.', 'चक्कर और उलझन लू का संकेत हो सकते हैं। तुरंत ठंडा करो और डॉक्टर बुलाओ।'],
      a: [['Move them to shade, cool them with a wet cloth, call for medical help', 'छाँव में ले जाओ, गीले कपड़े से ठंडा करो, डॉक्टर बुलाओ'], 'best'],
      b: [['Give small sips of water and let them rest', 'थोड़ा-थोड़ा पानी दो और आराम करने दो'], 'ok'],
      c: [['Give hot tea and let them sleep', 'गरम चाय दो और सोने दो'], 'wrong'],
    },
    {
      q: ['Water is running low at home. What do you do?', 'घर में पानी कम पड़ रहा है। क्या करोगे?'],
      why: ['Drinking water comes first. Ask the local office for water tankers.', 'पीने का पानी सबसे पहले। स्थानीय दफ़्तर से पानी के टैंकर माँगो।'],
      a: [['Keep drinking water first and ask for a tanker', 'पहले पीने का पानी रखो और टैंकर माँगो'], 'best'],
      b: [['Cut down cooking and washing water', 'खाना बनाने और धोने का पानी कम करो'], 'ok'],
      c: [['Water the plants and wash the floor', 'पौधों को पानी दो और फ़र्श धोओ'], 'wrong'],
    },
  ]),
};

export function scenarioById(id: ScenarioId): Scenario {
  return SCENARIOS[id];
}

export function scenarioList(): Scenario[] {
  return SCENARIO_IDS.map((id) => SCENARIOS[id]);
}

/** Finds the prompt index and choice for an answer id, or null if the scenario has no such choice. */
export function locateChoice(scenario: ScenarioId, choiceId: string): { prompt: number; choice: Choice } | null {
  const prompts = SCENARIOS[scenario]?.prompts ?? [];
  for (let k = 0; k < prompts.length; k++) {
    const choice = prompts[k].choices.find((c) => c.id === choiceId);
    if (choice) return { prompt: k, choice };
  }
  return null;
}

/** The label of the best answer for a prompt. */
export function bestChoice(scenario: ScenarioId, prompt: number): Choice | undefined {
  return SCENARIOS[scenario]?.prompts[prompt]?.choices.find((c) => c.grade === 'best');
}

// ---- wire format --------------------------------------------------------------------------

const ID_RE = /^[a-z0-9]{4,12}$/;
const CHOICE_RE = /^[0-9][abc]$/;
const MAX_ATMS = 60_000;

const isScenario = (v: unknown): v is ScenarioId => typeof v === 'string' && (SCENARIO_IDS as readonly string[]).includes(v);
const isName = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 32;
const isMs = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** Checks the shape of a parsed object and returns a clean copy with only the known keys. */
function validate(o: unknown): DrillMsg | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const m = o as Record<string, unknown>;
  const { t, id } = m;
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  if (t === 'start') {
    const { scenario, startedAt, by } = m;
    if (!isScenario(scenario) || !isMs(startedAt) || !isName(by)) return null;
    return { t, id, scenario, startedAt, by };
  }
  if (t === 'answer') {
    const { who, choiceId, atMs } = m;
    if (!isName(who) || typeof choiceId !== 'string' || !CHOICE_RE.test(choiceId)) return null;
    if (!isMs(atMs) || atMs > MAX_ATMS) return null;
    return { t, id, who, choiceId, atMs };
  }
  if (t === 'end') return { t, id };
  return null;
}

/** Text for a drill message, or null if the message is malformed or would exceed 400 characters. */
export function serialiseDrillMessage(msg: DrillMsg): string | null {
  const clean = validate(msg);
  if (!clean) return null;
  const text = PREFIX + JSON.stringify(clean);
  return text.length <= MAX_CHARS ? text : null;
}

/** Parses a chat message. Anything that is not a well-formed drill message gives null and is ignored. */
export function parseDrillMessage(text: unknown): DrillMsg | null {
  if (typeof text !== 'string' || !text.startsWith(PREFIX) || text.length > MAX_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(PREFIX.length));
  } catch {
    return null;
  }
  return validate(raw);
}

export const isDrillText = (text: unknown): text is string => typeof text === 'string' && text.startsWith(PREFIX);

/** A short random id for a new drill. Pass a fixed `rand` in tests. */
export function newDrillId(rand: () => number = Math.random): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

// ---- scoring ------------------------------------------------------------------------------

/** 50 at or under 5 seconds, falling linearly to 0 at 20 seconds. Rounds down so a late answer never gets more. */
export function speedBonus(reactionMs: number): number {
  if (!Number.isFinite(reactionMs)) return 0;
  const t = Math.max(0, reactionMs);
  if (t <= FAST_MS) return SPEED_MAX;
  if (t >= PROMPT_MS) return 0;
  return Math.floor((SPEED_MAX * (PROMPT_MS - t)) / (PROMPT_MS - FAST_MS));
}

/** best = 100, acceptable = 50, wrong = 0. The speed bonus is added to a correct answer only. */
export function scoreAnswer(grade: Grade, reactionMs: number): number {
  if (grade === 'wrong') return 0;
  return (grade === 'best' ? BEST_POINTS : OK_POINTS) + speedBonus(reactionMs);
}

// ---- state --------------------------------------------------------------------------------

export interface DrillAnswer {
  who: string;
  prompt: number;
  choiceId: string;
  grade: Grade;
  atMs: number;
  points: number;
}

export interface DrillRecord {
  id: string;
  scenario: ScenarioId;
  by: string;
  startedAt: number;
  ended: boolean;
  answers: DrillAnswer[];
}

export interface DrillState {
  drills: Record<string, DrillRecord>;
}

export const EMPTY_DRILLS: DrillState = { drills: {} };

/**
 * Applies one message to the state. Pure: returns the same object when nothing changes.
 * - a second `start` for a known id is ignored
 * - an answer is ignored when the drill is unknown, already ended, the choice is unknown, or this
 *   `who` already answered this prompt (the first answer wins)
 * - `end` is idempotent
 */
export function reduce(state: DrillState, msg: DrillMsg): DrillState {
  if (msg.t === 'start') {
    if (state.drills[msg.id]) return state;
    const rec: DrillRecord = { id: msg.id, scenario: msg.scenario, by: msg.by, startedAt: msg.startedAt, ended: false, answers: [] };
    return { drills: { ...state.drills, [msg.id]: rec } };
  }
  const d = state.drills[msg.id];
  if (!d) return state;
  if (msg.t === 'end') {
    if (d.ended) return state;
    return { drills: { ...state.drills, [d.id]: { ...d, ended: true } } };
  }
  if (d.ended) return state;
  const hit = locateChoice(d.scenario, msg.choiceId);
  if (!hit) return state;
  if (d.answers.some((a) => a.who === msg.who && a.prompt === hit.prompt)) return state;
  const answer: DrillAnswer = {
    who: msg.who,
    prompt: hit.prompt,
    choiceId: msg.choiceId,
    grade: hit.choice.grade,
    atMs: msg.atMs,
    points: scoreAnswer(hit.choice.grade, msg.atMs),
  };
  return { drills: { ...state.drills, [d.id]: { ...d, answers: [...d.answers, answer] } } };
}

/** Replays timestamped messages in time order (stable for equal timestamps). Malformed items should be parsed out first. */
export function replay(items: { msg: DrillMsg; ts: number }[]): DrillState {
  const ordered = items.map((x, i) => ({ ...x, i })).sort((a, b) => a.ts - b.ts || a.i - b.i);
  return ordered.reduce((s, x) => reduce(s, x.msg), EMPTY_DRILLS);
}

export interface Standing {
  who: string;
  score: number;
  /** answers given (timeouts are not counted) */
  answered: number;
  /** mean reaction time over the answers given, in ms; 0 when none */
  avgMs: number;
}

/** Scoreboard for one drill: highest score first, then the faster average, then name. */
export function leaderboard(state: DrillState, drillId: string): Standing[] {
  const d = state.drills[drillId];
  if (!d) return [];
  const byWho = new Map<string, DrillAnswer[]>();
  for (const a of d.answers) byWho.set(a.who, [...(byWho.get(a.who) ?? []), a]);
  const rows: Standing[] = [...byWho].map(([who, answers]) => ({
    who,
    score: answers.reduce((n, a) => n + a.points, 0),
    answered: answers.length,
    avgMs: Math.round(answers.reduce((n, a) => n + a.atMs, 0) / answers.length),
  }));
  return rows.sort((a, b) => b.score - a.score || a.avgMs - b.avgMs || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
}
