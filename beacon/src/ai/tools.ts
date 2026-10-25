// The tool catalogue Needle chooses from. Argument values are short everyday words (not internal ids)
// because Needle only fills arguments from words that appear in the request.

export type PlaceKind = 'shelter' | 'hospital' | 'water' | 'police' | 'pharmacy';

export type Action =
  | { type: 'guide'; id: string }
  | { type: 'disaster'; id: string }
  | { type: 'map'; place: PlaceKind }
  | { type: 'sos'; reason?: string }
  | { type: 'safe' }
  | { type: 'call112' }
  | { type: 'alerts' }
  | { type: 'chat' }
  | { type: 'settings'; setting: 'hindi' | 'english' | 'large_text' | 'high_contrast' | 'read_aloud' }
  | { type: 'none' };

/** Topic word -> guide id. */
export const FIRST_AID_TOPICS: Record<string, string> = {
  bleeding: 'severe-bleeding',
  burn: 'burns',
  broken_bone: 'fracture',
  not_breathing: 'cpr-adult',
  choking: 'choking-adult',
  choking_baby: 'choking-infant',
  unconscious: 'recovery-position',
  drowning: 'drowning',
  electric_shock: 'electric-shock',
  snake_bite: 'snake-bite',
  heat_stroke: 'heat-stroke',
  cold: 'hypothermia',
  diarrhoea: 'dehydration',
  head_injury: 'head-injury',
  nosebleed: 'nosebleed',
  eye: 'eye-injury',
  fainting: 'fainting',
  asthma: 'asthma',
  seizure: 'seizure',
  poison: 'poisoning',
  allergy: 'allergic-reaction',
  chest_pain: 'heart-attack',
  stroke: 'stroke',
  trapped: 'trapped-debris',
  small_cut: 'minor-wound',
  animal_bite: 'animal-bite',
  fire: 'smoke-fire',
};

export const REMEDY_ITEMS: Record<string, string> = {
  bandage: 'cloth-bandage',
  tourniquet: 'improvised-tourniquet',
  splint: 'newspaper-splint',
  sling: 'scarf-sling',
  ors: 'homemade-ors',
  clean_water: 'purify-water',
  burn_cover: 'plastic-wrap-burn',
  cold_pack: 'cold-compress',
  stretcher: 'stretcher',
  signal: 'emergency-signal',
  mask: 'dust-mask',
  warmth: 'insulate-warm',
  flotation: 'flood-float',
};

export const HAZARDS = ['earthquake', 'flood', 'cyclone', 'landslide', 'heatwave', 'lightning', 'tsunami'] as const;
export const PLACES: PlaceKind[] = ['shelter', 'hospital', 'water', 'police', 'pharmacy'];

export const SYSTEM_PROMPT =
  'You route emergency requests for a disaster safety app. Pick the single best tool. ' +
  'If someone is hurt or sick use show_first_aid. If they ask how to make something from household items use show_home_remedy. ' +
  'If they are in danger and ask for rescue use send_sos.';

export const TOOLS = [
  {
    name: 'show_first_aid',
    description: 'Show first-aid steps for an injury or medical emergency (bleeding, burn, broken bone, choking, snake bite, ...).',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', enum: Object.keys(FIRST_AID_TOPICS), description: 'what is wrong with the person' } },
      required: ['topic'],
    },
  },
  {
    name: 'show_home_remedy',
    description: 'Show how to make or improvise something from household items (bandage, splint, ORS, clean water, stretcher, ...).',
    parameters: {
      type: 'object',
      properties: { item: { type: 'string', enum: Object.keys(REMEDY_ITEMS), description: 'what to make or do' } },
      required: ['item'],
    },
  },
  {
    name: 'show_disaster_guide',
    description: 'Show what to do before, during and after a disaster (earthquake, flood, cyclone, landslide, heatwave, lightning, tsunami).',
    parameters: {
      type: 'object',
      properties: { hazard: { type: 'string', enum: [...HAZARDS] } },
      required: ['hazard'],
    },
  },
  {
    name: 'find_nearest',
    description: 'Find the nearest shelter, hospital, drinking water, police station or pharmacy on the offline map.',
    parameters: {
      type: 'object',
      properties: { place: { type: 'string', enum: PLACES } },
      required: ['place'],
    },
  },
  {
    name: 'send_sos',
    description: 'Send an SOS with my location to nearby phones and my emergency contacts. For when I am in danger or need rescue.',
    parameters: { type: 'object', properties: { reason: { type: 'string', description: 'why help is needed' } }, required: [] },
  },
  { name: 'mark_safe', description: 'Tell my family and nearby people "I am safe".', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'call_emergency', description: 'Call the emergency number 112.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'read_alerts', description: 'Show or read out current weather, earthquake and disaster alerts near me.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'open_chat', description: 'Open the community chat to talk to people nearby.', parameters: { type: 'object', properties: {}, required: [] } },
  {
    name: 'change_setting',
    description: 'Change an app setting: language, large text, high contrast or reading aloud.',
    parameters: {
      type: 'object',
      properties: { setting: { type: 'string', enum: ['hindi', 'english', 'large_text', 'high_contrast', 'read_aloud'] } },
      required: ['setting'],
    },
  },
] as const;

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Turn a tool call (from Needle or the keyword router) into something the UI can act on. */
export function toAction(call: ToolCall): Action {
  const a = call.arguments ?? {};
  switch (call.name) {
    case 'show_first_aid': {
      const id = FIRST_AID_TOPICS[String(a.topic)];
      return id ? { type: 'guide', id } : { type: 'none' };
    }
    case 'show_home_remedy': {
      const id = REMEDY_ITEMS[String(a.item)];
      return id ? { type: 'guide', id } : { type: 'none' };
    }
    case 'show_disaster_guide':
      return HAZARDS.includes(a.hazard as never) ? { type: 'disaster', id: String(a.hazard) } : { type: 'none' };
    case 'find_nearest':
      return PLACES.includes(a.place as PlaceKind) ? { type: 'map', place: a.place as PlaceKind } : { type: 'none' };
    case 'send_sos':
      return { type: 'sos', reason: typeof a.reason === 'string' ? a.reason : undefined };
    case 'mark_safe':
      return { type: 'safe' };
    case 'call_emergency':
      return { type: 'call112' };
    case 'read_alerts':
      return { type: 'alerts' };
    case 'open_chat':
      return { type: 'chat' };
    case 'change_setting': {
      const s = String(a.setting);
      return ['hindi', 'english', 'large_text', 'high_contrast', 'read_aloud'].includes(s)
        ? { type: 'settings', setting: s as never }
        : { type: 'none' };
    }
    default:
      return { type: 'none' };
  }
}
