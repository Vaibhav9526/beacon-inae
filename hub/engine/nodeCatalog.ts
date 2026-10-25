import type { NodeKind, NodeSpec } from './types.ts';

export interface NodeField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'list' | 'select' | 'json' | 'toggle';
  options?: string[];
  placeholder?: string;
}

export interface NodeKindInfo {
  kind: NodeKind;
  label: string;
  description: string;
  /** source nodes produce items; the rest change the stream passing through them */
  source: boolean;
  fields: NodeField[];
}

const KINDS = ['news', 'weather', 'wind', 'quake', 'flood', 'alert', 'health', 'supply', 'advisory', 'custom'];

/** What the UI shows when you add a node to an agent's path. */
export const NODE_KINDS: NodeKindInfo[] = [
  {
    kind: 'rss',
    label: 'News feed (RSS)',
    description: 'Reads headlines from an RSS or Atom feed.',
    source: true,
    fields: [
      { key: 'url', label: 'Feed address', type: 'text', placeholder: 'https://example.com/feed.xml' },
      { key: 'limit', label: 'How many items', type: 'number', placeholder: '8' },
      { key: 'kind', label: 'Shows up as', type: 'select', options: KINDS },
    ],
  },
  {
    kind: 'http-json',
    label: 'Web data (JSON)',
    description: 'Fetches a JSON address and picks items out of it.',
    source: true,
    fields: [
      { key: 'url', label: 'Address', type: 'text', placeholder: 'https://api.example.com/items' },
      { key: 'path', label: 'Where the items are', type: 'text', placeholder: 'data.items' },
      { key: 'titleKey', label: 'Title field', type: 'text', placeholder: 'title' },
      { key: 'bodyKey', label: 'Text field', type: 'text', placeholder: 'summary' },
      { key: 'urlKey', label: 'Link field', type: 'text', placeholder: 'url' },
      { key: 'kind', label: 'Shows up as', type: 'select', options: KINDS },
      { key: 'limit', label: 'How many items', type: 'number', placeholder: '8' },
    ],
  },
  {
    kind: 'weather',
    label: 'Weather and wind',
    description: 'Current weather or wind for the agent’s place (Open-Meteo, free).',
    source: true,
    fields: [{ key: 'metric', label: 'What to watch', type: 'select', options: ['weather', 'wind'] }],
  },
  { kind: 'aqi', label: 'Air quality', description: 'US AQI and PM2.5 for the agent’s place.', source: true, fields: [] },
  {
    kind: 'quake',
    label: 'Earthquakes (USGS)',
    description: 'Reports quakes of magnitude 4.5 or more near the agent’s place.',
    source: true,
    fields: [{ key: 'radiusKm', label: 'Radius (km)', type: 'number', placeholder: '500' }],
  },
  {
    kind: 'cap',
    label: 'Official alerts (CAP)',
    description: 'Reads a CAP alert feed such as NDMA SACHET.',
    source: true,
    fields: [
      { key: 'url', label: 'Feed address', type: 'text', placeholder: 'https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?' },
      { key: 'filterByPlace', label: 'Only alerts for my state', type: 'toggle' },
    ],
  },
  {
    kind: 'mcp-tool',
    label: 'MCP tool',
    description: 'Calls a tool on a connected MCP server and turns the result into items.',
    source: true,
    fields: [
      { key: 'server', label: 'MCP server', type: 'text', placeholder: 'server id' },
      { key: 'tool', label: 'Tool', type: 'text', placeholder: 'tool name' },
      { key: 'args', label: 'Arguments (JSON)', type: 'json', placeholder: '{}' },
      { key: 'kind', label: 'Shows up as', type: 'select', options: KINDS },
    ],
  },
  {
    kind: 'keyword-filter',
    label: 'Keyword filter',
    description: 'Keeps or removes items by words in the title or text.',
    source: false,
    fields: [
      { key: 'words', label: 'Words', type: 'list', placeholder: 'flood, cyclone' },
      { key: 'mode', label: 'Keep items that have', type: 'select', options: ['any', 'all', 'none'] },
    ],
  },
  {
    kind: 'threshold',
    label: 'Threshold',
    description: 'Keeps items whose number passes a limit (for example wind above 40).',
    source: false,
    fields: [
      { key: 'key', label: 'Number', type: 'text', placeholder: 'wind_kmh' },
      { key: 'op', label: 'Is', type: 'select', options: ['>', '>=', '<', '<=', '==', '!='] },
      { key: 'value', label: 'Value', type: 'number' },
    ],
  },
  { kind: 'dedupe', label: 'Remove repeats', description: 'Drops items with the same title.', source: false, fields: [] },
  { kind: 'summarize', label: 'Short summary', description: 'Shortens long text to about 60 words.', source: false, fields: [] },
];

const BY_KIND = new Map(NODE_KINDS.map((k) => [k.kind, k]));
export const nodeKindInfo = (k: string) => BY_KIND.get(k as NodeKind);

let counter = 0;
const newNodeId = () => `n-${Date.now().toString(36)}${(counter++ % 1296).toString(36)}`;

/** Checks and tidies the nodes the UI sends: known kinds only, ids and labels filled in, config always an object. */
export function cleanPipeline(nodes: unknown): NodeSpec[] {
  if (!Array.isArray(nodes)) throw new Error('nodes must be a list');
  if (nodes.length > 20) throw new Error('At most 20 nodes per agent');
  const seen = new Set<string>();
  return nodes.map((raw, i) => {
    const n = (raw ?? {}) as Partial<NodeSpec>;
    const info = nodeKindInfo(String(n.kind));
    if (!info) throw new Error(`Unknown node kind at position ${i + 1}`);
    let id = typeof n.id === 'string' && n.id ? n.id : newNodeId();
    while (seen.has(id)) id = newNodeId();
    seen.add(id);
    const config = n.config && typeof n.config === 'object' && !Array.isArray(n.config) ? { ...(n.config as Record<string, unknown>) } : {};
    return { id, kind: info.kind, label: typeof n.label === 'string' && n.label.trim() ? n.label.trim().slice(0, 60) : info.label, config, enabled: n.enabled !== false };
  });
}
