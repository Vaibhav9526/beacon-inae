// In-memory fake of the hub's local API (docs/hub-v2-api.md). Used when the page is opened with ?demo=1.
// Same shapes as hub/engine/types.ts. Mutations change the in-memory state; api.js then refreshes.
// Add ?pending=1 to start with an approval waiting (state.pending).

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const seq = { agent: 100, member: 100, mcp: 10, rule: 100, node: 500, msg: 100, join: 1 };
const nid = (k) => k + (++seq[k]);

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

/* ---------- seed data ---------- */

const personas = [
  persona('firefighter', 'Flint', 'Firefighter', 'Fire and smoke, calmly', 'Flint watches for fire risk, smoke and gas near home. He keeps sentences short and says exactly where to go.', 'peach', 'rescue', [2, 1, '#E0482F'], ['Fire safety', 'Smoke', 'Evacuation'], 'Short, clear, direct.', 'Flint, fire safety', ['weather-watch'], 'veer'),
  persona('doctor', 'Asha', 'Doctor', 'Heart and breath, gently', 'Asha keeps an eye on heart rate, oxygen and the medicines a family member takes. She never guesses, she asks for a check.', 'pink', 'medic', [1, 3, '#FDB155'], ['Heart rate', 'Oxygen', 'Medicines'], 'Warm, plain, reassuring.', 'Dr. Asha, family health', ['family-health'], 'asha'),
  persona('rescuer', 'Veer', 'Rescue captain', 'Quake and flood readiness', 'Veer tracks earthquakes and flood water near the house and tells the family what to grab and where to stand.', 'blue', 'sentinel', [4, 2, '#2F7DE0'], ['Earthquakes', 'Flood', 'Rescue'], 'Steady, practical.', 'Captain Veer, rescue', ['quake-flood'], 'veer'),
  persona('teacher', 'Didi', 'Teacher', 'Children and play', 'Didi keeps children safe outdoors: heat, UV and air. She explains the why in one line.', 'yellow', 'scout', [0, 0, '#E0A02F'], ['Child safety', 'UV', 'Play'], 'Friendly, simple words.', 'Didi, school and play', ['child-play-guardian'], 'didi'),
  persona('scientist', 'Megh', 'Weather scientist', 'Winds, rain and heat', 'Megh reads the weather models and says what the wind, rain and heat will really do, with the numbers.', 'lilac', 'guardian', [5, 4, '#8A3FD6'], ['Wind', 'Rain', 'Heat index'], 'Precise, calm, with numbers.', 'Megh, weather desk', ['heatwave-guardian'], 'default'),
  persona('pharmacist', 'Dawa', 'Pharmacist', 'Medicine and supply', 'Dawa watches medicine stock and dose times, and warns before a family runs short.', 'green', 'medic', [3, 2, '#2FA35B'], ['Medicine', 'Dose times', 'Stock'], 'Careful, exact.', 'Dawa, medicine desk', ['medicine-reminder'], 'asha'),
  persona('helper', 'Seva', 'Community helper', 'Local news and neighbours', 'Seva reads the local news and passes on only what neighbours need to know, without panic.', 'pink', 'coach', [6, 5, '#D6408F'], ['Local news', 'Neighbours', 'Summaries'], 'Warm, brief.', 'Seva, community', ['route-supply'], 'didi'),
  persona('engineer', 'Neev', 'Engineer', 'Roads, power and water', 'Neev follows roads, power cuts and water supply, and says which route is open.', 'blue', 'sentinel', [2, 4, '#2F9FB5'], ['Roads', 'Power', 'Water'], 'Factual, short.', 'Neev, infrastructure', ['route-supply'], 'default')
];

function persona(id, name, role, tagline, about, tint, avatar, lookArr, skills, voice, signature, templates, speaks) {
  return { id, name, role, tagline, about, tint, avatar, look: { hair: lookArr[0], skin: lookArr[1], color: lookArr[2] }, skills, voice, signature, templates, speaks };
}

const TEMPLATE_NAMES = [
  ['heat-watch', 'Heat watch', 'disaster', 'Heat index and warm nights for the house.'],
  ['flood-rain', 'Flood and rain', 'disaster', 'Rain totals and rising water near home.'],
  ['quake-felt', 'Earthquake felt', 'disaster', 'Quakes above magnitude 4.5 within 300 km.'],
  ['cyclone-path', 'Cyclone path', 'disaster', 'Official cyclone bulletins for the coast.'],
  ['air-quality', 'Air quality', 'disaster', 'Air index and fine dust for children and elders.'],
  ['official-alerts', 'Official alerts', 'disaster', 'Government alerts for the district.'],
  ['family-heart', 'Family heart rate', 'help', 'Heart rate readings for one family member.'],
  ['oxygen-check', 'Oxygen check', 'help', 'Oxygen readings that drop below safe levels.'],
  ['elders-heat', 'Elders in heat', 'help', 'Heat and water reminders for elders.'],
  ['road-rain', 'Roads and rain', 'help', 'Road closures and waterlogging on the route to school.'],
  ['power-outage', 'Power outage', 'help', 'Scheduled and sudden power cuts in the area.'],
  ['fire-smoke', 'Fire and smoke', 'disaster', 'Smoke reports and fire alerts nearby.'],
  ['medicine-reminder', 'Medicine reminder', 'medicine', 'Dose times and stock for daily medicines.'],
  ['supply-stock', 'Food and water stock', 'prepare', 'Days of food, water and medicine left at home.'],
  ['child-play-uv', 'Child play and UV', 'child', 'UV and air before school play time.'],
  ['school-closures', 'School closures', 'child', 'School notices and closures for the area.'],
  ['local-news', 'Local news', 'help', 'Short summaries of local news for the family.'],
  ['hospital-queue', 'Hospital queue', 'help', 'Wait times at the nearest hospital.']
];

const templates = TEMPLATE_NAMES.map(([id, name, group, summary], i) => ({
  id, name, summary, group,
  avatar: ['rescue', 'medic', 'sentinel', 'scout', 'guardian', 'coach'][i % 6],
  about: summary + ' Two plain sentences for the family, set up once.',
  watches: ['Readings', 'Official alerts'],
  sources: ['Open-Meteo', 'NDMA SACHET'],
  example: 'Calm check: nothing needs you right now.',
  who: 'Whole family',
  level: i % 3 === 0 ? 'starter' : i % 3 === 1 ? 'guardian' : 'expert',
  needs: i % 4 === 2 ? ['health'] : [],
  agent: { name: name, avatar: 'sentinel', enabled: false, watch: ['weather'], everyMin: 30, rules: [], channels: ['beacon'], genre: 'custom' }
}));

const RULE = (id, name, metric, op, value, severity, message) => ({ id, name, when: { mode: 'all', conditions: [{ metric, op, value }] }, severity, message, cooldownMin: 360 });

const NODE = (id, kind, label, config, enabled = true) => ({ id, kind, label, config, enabled });

const agents = [
  {
    id: 'a1', name: 'Flint', avatar: 'rescue', personaId: 'firefighter', genre: 'flood', enabled: true,
    watch: ['weather', 'alerts'], place: { name: 'Kochi', lat: 9.9312, lon: 76.2673, state: 'kerala' }, members: [],
    everyMin: 15, channels: ['telegram', 'beacon'], notes: 'Check the river gauge after rain.',
    rules: [RULE('r1', 'Heavy rain', 'rain_mm_24h', '>=', 60, 'warning', 'Heavy rain: {rain_mm_24h} mm in 24 hours.')],
    pipeline: [NODE('n1', 'rss', 'Local news feed', { url: 'https://example.org/kochi.xml', limit: 20 }), NODE('n2', 'keyword-filter', 'Flood words', { words: ['flood', 'rain', 'water'], mode: 'any' })],
    createdAt: now() - 5 * DAY
  },
  {
    id: 'a2', name: 'Maa heart watch', avatar: 'medic', personaId: 'doctor', genre: 'health', enabled: true,
    watch: ['health'], place: null, members: ['Maa'], everyMin: 5, channels: ['beacon'], notes: 'Maa takes BP tablets at 8am.',
    rules: [RULE('r2', 'Maa heart rate high', 'hr:Maa', '>', 110, 'warning', 'Maa heart rate is {hr:Maa}. Please check on her.')],
    pipeline: [NODE('n3', 'http-json', 'Phone readings', { url: 'http://127.0.0.1:8080/readings', path: 'maa' }), NODE('n4', 'threshold', 'Heart rate above 110', { metric: 'hr:Maa', op: '>', value: 110 })],
    createdAt: now() - 3 * DAY
  },
  {
    id: 'a3', name: 'Veer quake', avatar: 'sentinel', personaId: 'rescuer', genre: 'quake', enabled: true,
    watch: ['quake'], place: { name: 'Delhi', lat: 28.6139, lon: 77.209, state: 'delhi' }, members: [],
    everyMin: 10, channels: ['telegram', 'beacon'], notes: '',
    rules: [RULE('r3', 'Strong quake', 'quake_max_mag', '>=', 4.5, 'severe', 'Quake magnitude {quake_max_mag} within 300 km.')],
    pipeline: [NODE('n5', 'quake', 'USGS quakes', { radiusKm: 300, minMag: 2.5 }), NODE('n6', 'threshold', 'Magnitude 4.5 or more', { metric: 'quake_max_mag', op: '>=', value: 4.5 })],
    createdAt: now() - 9 * DAY
  },
  {
    id: 'a4', name: 'Megh winds', avatar: 'guardian', personaId: 'scientist', genre: 'wind', enabled: true,
    watch: ['weather'], place: { name: 'Chennai', lat: 13.0827, lon: 80.2707, state: 'tamil nadu' }, members: [],
    everyMin: 30, channels: ['beacon'], notes: '',
    rules: [RULE('r4', 'Strong gusts', 'wind_gust_kmh', '>=', 60, 'warning', 'Gusts up to {wind_gust_kmh} km/h.')],
    pipeline: [NODE('n7', 'weather', 'Open-Meteo wind', { lat: 13.08, lon: 80.27 }), NODE('n8', 'threshold', 'Gusts 60 or more', { metric: 'wind_gust_kmh', op: '>=', value: 60 })],
    createdAt: now() - 2 * DAY
  },
  {
    id: 'a5', name: 'Dawa supply', avatar: 'medic', personaId: 'pharmacist', genre: 'supply', enabled: false,
    watch: ['supply'], place: null, members: ['Papa'], everyMin: 60, channels: ['beacon'], notes: '',
    rules: [RULE('r5', 'Medicine running low', 'medicine_days', '<=', 5, 'watch', 'Medicine stock is {medicine_days} days.')],
    pipeline: [NODE('n9', 'keyword-filter', 'Medicine words', { words: ['medicine', 'tablet'], mode: 'any' }), NODE('n10', 'dedupe', 'Drop repeats', { windowHours: 12 })],
    createdAt: now() - 12 * DAY
  },
  {
    id: 'a6', name: 'Seva news', avatar: 'coach', personaId: 'helper', genre: 'news', enabled: true,
    watch: ['alerts'], place: { name: 'Kochi', lat: 9.9312, lon: 76.2673, state: 'kerala' }, members: [],
    everyMin: 60, channels: ['beacon'], notes: '',
    rules: [],
    pipeline: [NODE('n11', 'rss', 'Neighbourhood news', { url: 'https://example.org/news.xml', limit: 30 }), NODE('n12', 'keyword-filter', 'Community', { words: ['school', 'road', 'water'], mode: 'any' }), NODE('n13', 'dedupe', 'Drop repeats', {}), NODE('n14', 'summarize', 'Short summary', { words: 40 })],
    createdAt: now() - 20 * DAY
  }
];

function now() { return Date.now(); }

const runs = [
  { at: now() - 6 * MIN, agentId: 'a2', ok: true, message: 'Checked. Heart rate 96.', signals: 0 },
  { at: now() - 21 * MIN, agentId: 'a1', ok: true, message: 'Checked. Rain 14 mm in 24 hours.', signals: 0 },
  { at: now() - 52 * MIN, agentId: 'a4', ok: true, message: 'Checked. Gusts 38 km/h.', signals: 0 },
  { at: now() - 2 * HOUR, agentId: 'a3', ok: true, message: 'Checked. Largest quake 3.1 today.', signals: 0 },
  { at: now() - 2.5 * HOUR, agentId: 'a2', ok: true, message: 'Heart rate 118 for 2 minutes.', signals: 1 },
  { at: now() - 3 * HOUR, agentId: 'a5', ok: false, message: 'Feed not reachable: connection timed out.' },
  { at: now() - 5 * HOUR, agentId: 'a6', ok: true, message: 'Read 14 items, kept 3.', signals: 0 },
  { at: now() - 1 * DAY, agentId: 'a1', ok: true, message: 'Checked. Rain 62 mm in 24 hours.', signals: 1 },
  { at: now() - 1 * DAY - HOUR, agentId: 'a4', ok: true, message: 'Checked. Gusts 52 km/h.', signals: 0 }
];

const alertSignal = (agentId, agentName, ruleId, severity, title, body, at) => ({ agentId, agentName, ruleId, severity, title, body, metrics: {}, fingerprint: agentId + ':' + ruleId, tags: [agentId], at });

const alerts = [
  {
    id: 'al3', severity: 'warning', title: 'Maa heart rate high', body: 'Maa heart rate is 118. Please check on her.',
    channels: ['telegram', 'beacon'], status: 'pending-approval', at: now() - 4 * MIN,
    signals: [alertSignal('a2', 'Maa heart watch', 'r2', 'warning', 'Maa heart rate high', 'Maa heart rate is 118.', now() - 4 * MIN)]
  },
  {
    id: 'al2', severity: 'watch', title: 'Rain building', body: 'Rain 62 mm in 24 hours near Kochi.',
    channels: ['beacon'], status: 'sent', at: now() - 1 * DAY,
    signals: [alertSignal('a1', 'Flint', 'r1', 'warning', 'Heavy rain', 'Rain 62 mm.', now() - 1 * DAY)]
  },
  {
    id: 'al1', severity: 'severe', title: 'Cyclone bulletin', body: 'Official cyclone bulletin for the coast.',
    channels: ['telegram'], status: 'sent', at: now() - 3 * DAY,
    signals: [alertSignal('a6', 'Seva news', 'r0', 'severe', 'Cyclone bulletin', 'Official bulletin.', now() - 3 * DAY)]
  }
];

const feed = [
  feedItem('f1', 'a1', 'Flint', 'flood', 'warning', 'Rain 62 mm in 24 hours near Kochi', 'Heavy rain is expected overnight. Keep valuables above ground level.', 1, ['rain']),
  feedItem('f2', 'a4', 'Megh winds', 'wind', 'watch', 'Gusts up to 52 km/h on the coast', 'Winds pick up after noon. Secure loose items on balconies.', 2, ['wind']),
  feedItem('f3', 'a3', 'Veer quake', 'quake', 'info', 'Quake M3.1 near Delhi', 'Small quake, no damage reported. No action needed.', 3, ['quake']),
  feedItem('f4', 'a2', 'Maa heart watch', 'health', 'warning', 'Maa heart rate 118', 'Heart rate has been high for 2 minutes. Please check on her.', 4, ['health']),
  feedItem('f5', 'a5', 'Dawa supply', 'supply', 'watch', 'Medicine stock: 5 days left', 'Refill the daily tablets this week.', 6, ['medicine']),
  feedItem('f6', 'a6', 'Seva news', 'news', 'info', 'Water supply back on Ward 12', 'Supply restored after the pipe repair on Friday.', 8, ['water']),
  feedItem('f7', 'a6', 'Seva news', 'news', 'info', 'School bus route changed', 'Route 4 avoids the flooded bridge until Monday.', 9, ['school']),
  feedItem('f8', 'a1', 'Flint', 'flood', 'info', 'River gauge stable', 'The river gauge at Kochi is steady since morning.', 12, ['river']),
  feedItem('f9', 'a4', 'Megh winds', 'advisory', 'info', 'Heat index 38 this afternoon', 'Drink water and keep elders indoors between 12 and 4.', 14, ['heat']),
  feedItem('f10', 'a3', 'Veer quake', 'quake', 'watch', 'Two quakes M3 in Himachal', 'No alert for your place. Watching.', 18, ['quake']),
  feedItem('f11', 'a6', 'Seva news', 'news', 'info', 'Community clean-up Saturday', 'Meet at the park gate at 7am.', 22, ['community']),
  feedItem('f12', 'a2', 'Maa heart watch', 'health', 'info', 'Maa heart rate normal', 'Back to 84 after the morning walk.', 26, ['health'])
];

function feedItem(id, agentId, agentName, kind, severity, title, body, hoursAgo, tags) {
  return { id, agentId, agentName, nodeId: null, kind, title, body, severity, at: now() - hoursAgo * HOUR, tags, place: 'Kochi' };
}

const members = [
  { id: 'm1', name: 'Papa', role: 'adult', deviceId: 'dev-papa', healthName: 'Papa', look: { hair: 0, skin: 2, color: '#2F7DE0' }, joinedAt: now() - 40 * DAY },
  { id: 'm2', name: 'Maa', role: 'adult', deviceId: 'dev-maa', healthName: 'Maa', look: { hair: 3, skin: 1, color: '#D6408F' }, joinedAt: now() - 40 * DAY },
  { id: 'm3', name: 'Dadu', role: 'elder', deviceId: 'dev-dadu', healthName: 'Dadu', look: { hair: 2, skin: 3, color: '#8A3FD6' }, joinedAt: now() - 30 * DAY },
  { id: 'm4', name: 'Kiara', role: 'child', deviceId: 'dev-kiara', look: { hair: 4, skin: 0, color: '#FDB155' }, joinedAt: now() - 10 * DAY }
];

const messages = [
  msg('g1', 'hub', 'Hub', 'Hub is watching. Rain is building near Kochi.', 'agent', 5 * HOUR),
  msg('g2', 'm1', 'Papa', 'Ok, I will check the river gauge after lunch.', 'text', 4.6 * HOUR),
  msg('g3', 'm2', 'Maa', 'I took the BP tablet at 8.', 'text', 4 * HOUR),
  msg('g4', 'm4', 'Kiara', 'Can we go to the park?', 'text', 3 * HOUR),
  msg('g5', 'hub', 'Hub', 'UV is high after 11. Park is fine before 10.', 'agent', 2.9 * HOUR),
  msg('g6', 'm3', 'Dadu', 'Safe. I am home.', 'safe', 2 * HOUR),
  msg('g7', 'm2', 'Maa', 'Feeling a bit tired, will rest.', 'text', 1.5 * HOUR),
  msg('g8', 'hub', 'Hub', 'Maa heart rate 118 for 2 minutes. Asha is checking.', 'alert', 0.1 * HOUR),
  msg('g9', 'm1', 'Papa', 'I am on my way.', 'text', 0.08 * HOUR),
  msg('g10', 'm4', 'Kiara', 'Ok', 'text', 0.05 * HOUR)
];

function msg(id, from, fromName, text, kind, agoMs) {
  return { id, from, fromName, text, kind, at: now() - agoMs };
}

const routes = [
  { id: 'rt1', name: 'Everything urgent', enabled: true, match: { minSeverity: 'warning' }, to: { phones: 'all' }, notifyFrom: 'warning' },
  { id: 'rt2', name: 'News', enabled: true, match: { kinds: ['news', 'advisory'] }, to: { phones: 'all' }, notifyFrom: 'severe' },
  { id: 'rt3', name: 'Health for adults', enabled: true, match: { kinds: ['health'] }, to: { phones: 'none', roles: ['adult'] }, notifyFrom: 'warning' },
  { id: 'rt4', name: 'Elders: warnings in plain words', enabled: false, match: { minSeverity: 'watch' }, to: { phones: 'none', roles: ['elder'] }, notifyFrom: 'warning', continue: true }
];

const mcpServers = [
  { id: 'mcp1', name: 'Weather tools', transport: 'http', url: 'http://127.0.0.1:9000/mcp', headers: { Authorization: 'Bearer demo' }, enabled: true },
  { id: 'mcp2', name: 'Local files', transport: 'stdio', command: 'npx', args: ['-y', '@example/files'], env: {}, enabled: false }
];

const mcpStatus = [
  { id: 'mcp1', connected: true, toolCount: 3 },
  { id: 'mcp2', connected: false, toolCount: 0, error: 'Not started' }
];

const mcpTools = [
  { server: 'mcp1', name: 'get_forecast', description: 'Forecast for a place', inputSchema: {} },
  { server: 'mcp1', name: 'get_alerts', description: 'Official alerts for a district', inputSchema: {} },
  { server: 'mcp1', name: 'get_air', description: 'Air quality index', inputSchema: {} }
];

const nodeKinds = [
  kind('rss', 'RSS feed', 'Reads a news feed and turns each entry into an item.', true, [f('url', 'Feed URL', 'text', { placeholder: 'https://' }), f('limit', 'Items to read', 'number')]),
  kind('http-json', 'JSON reading', 'Reads a number or list from a JSON address.', true, [f('url', 'Address', 'text'), f('path', 'Path in the JSON', 'text')]),
  kind('weather', 'Weather', 'Temperature, wind and rain for a place.', true, [f('lat', 'Latitude', 'number'), f('lon', 'Longitude', 'number')]),
  kind('aqi', 'Air quality', 'Air index and fine dust.', true, [f('lat', 'Latitude', 'number'), f('lon', 'Longitude', 'number')]),
  kind('quake', 'Earthquakes', 'Recent quakes within a radius.', true, [f('radiusKm', 'Radius (km)', 'number'), f('minMag', 'Minimum magnitude', 'number')]),
  kind('cap', 'Official alerts (CAP)', 'Government alert feed.', true, [f('url', 'Feed URL', 'text')]),
  kind('mcp-tool', 'MCP tool', 'Calls a tool on an MCP server.', true, [f('server', 'Server', 'select', { options: ['Weather tools', 'Local files'] }), f('tool', 'Tool', 'text'), f('args', 'Arguments', 'json')]),
  kind('owm-current', 'OpenWeather now', 'Current weather for the place. Needs your OpenWeather key.', true, [f('part', 'What to show', 'select', { options: ['all', 'wind', 'rain', 'temperature', 'air', 'alerts'] })]),
  kind('owm-forecast', 'OpenWeather forecast', 'The next 24 hours in 3 hour steps.', true, [f('part', 'What to show', 'select', { options: ['all', 'wind', 'rain', 'temperature', 'air', 'alerts'] })]),
  kind('owm-air', 'OpenWeather air quality', 'Air index with PM2.5, PM10 and gases.', true, [f('part', 'What to show', 'select', { options: ['all', 'wind', 'rain', 'temperature', 'air', 'alerts'] })]),
  kind('owm-onecall', 'OpenWeather One Call', 'Alerts, UV and a 48 hour outlook. Needs the One Call by Call subscription.', true, [f('part', 'What to show', 'select', { options: ['all', 'wind', 'rain', 'temperature', 'air', 'alerts'] })]),
  kind('keyword-filter', 'Keyword filter', 'Keeps items with these words.', false, [f('words', 'Words', 'list'), f('mode', 'Match', 'select', { options: ['any', 'all'] })]),
  kind('threshold', 'Threshold', 'Passes items when a reading crosses a value.', false, [f('metric', 'Reading', 'text'), f('op', 'Compare', 'select', { options: ['>', '>=', '<', '<='] }), f('value', 'Value', 'number')]),
  kind('summarize', 'Summary', 'Shortens the text to a few words.', false, [f('words', 'Words', 'number')]),
  kind('dedupe', 'Drop repeats', 'Removes items seen in the window.', false, [f('windowHours', 'Window (hours)', 'number')])
];

function kind(k, label, description, source, fields) { return { kind: k, label, description, source, fields }; }
function f(key, label, type, extra) { return Object.assign({ key, label, type }, extra || {}); }

const S = {
  agents,
  templates,
  personas,
  runs,
  alerts,
  audit: [],
  connections: {
    telegram: { mode: 'relay', state: 'connected', connected: true, paired: 3, bot: 'beacon_family_bot', saved: true, hint: 'Saved (ends ...demo)', chats: [{ id: 1, name: 'Family' }, { id: 2, name: 'Maa and Papa' }, { id: 3, name: 'Dadi' }] },
    beacon: { paired: 3 },
    brain: { kind: 'claude', ok: true },
    haiku: true,
    openWeather: { hasKey: false }
  },
  pending: params.get('pending') === '1'
    ? { id: 'p1', alertId: 'al3', text: 'Maa heart rate 118. Please check on her now.', channels: ['telegram', 'beacon'] }
    : null,
  members: ['Maa', 'Papa', 'Dadu', 'Kiara'],
  situation: {
    phase: 'watch', level: 1, since: now() - 40 * MIN,
    headline: 'Watch: rain is building near Kochi.',
    reasons: ['Rain 62 mm in 24 hours near Kochi', 'Maa heart rate 118 for 2 minutes'],
    actions: ['Check the river gauge after lunch.', 'Check on Maa and take her pulse again.']
  },
  feed,
  group: {
    members,
    messages,
    pendingJoins: [{ deviceId: 'dev-ritu', name: "Ritu's phone", at: now() - 4 * MIN }],
    asks: [
      { id: 'k1', memberId: 'm4', name: 'Kiara', text: 'Is it safe to go to the park?', at: now() - 12 * MIN, status: 'pending' },
      { id: 'k2', memberId: 'm3', name: 'Dadu', text: 'Will the rain stop tomorrow?', at: now() - 3 * HOUR, status: 'answered', answer: 'Rain likely until the evening. Stay in.' }
    ],
    allowAdultAsks: true
  },
  gateway: { routes, digests: [{ routeId: 'urgent', name: 'Everything urgent', everyMin: 60, queued: 3, nextAt: now() + 12 * MIN, lastFlush: now() - 48 * MIN }] },
  mcp: { servers: mcpServers, status: mcpStatus, tools: mcpTools },
  nodeKinds
};

/* ---------- helpers ---------- */

const clone = (x) => JSON.parse(JSON.stringify(x));
const delay = () => new Promise((r) => setTimeout(r, 60));

function fail(msg) {
  const e = new Error(msg);
  e.status = 400;
  throw e;
}

function findAgent(id) {
  const a = S.agents.find((x) => x.id === id);
  if (!a) fail('Agent not found');
  return a;
}

function personaById(id) {
  return S.personas.find((p) => p.id === id) || null;
}

function qrDataUrl(text) {
  let cells = '';
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 21; x++) {
      const on = ((x * 7 + y * 13 + text.length) % 5) < 2 || (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      if (on) cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    }
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" width="210" height="210"><rect width="21" height="21" fill="#fff"/><g fill="#000">' + cells + '</g></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function parseRuleText(text) {
  const t = text.toLowerCase();
  let metric = 'rain_mm_24h';
  let op = '>=';
  let value = 50;
  let severity = 'watch';
  const hr = /heart|pulse/.test(t) ? 'hr:' + (S.members[0] || 'Maa') : null;
  if (hr) { metric = hr; op = '>'; value = 110; }
  if (/heat/.test(t)) { metric = 'heat_index_c'; op = '>='; value = 41; }
  if (/quake|earthquake/.test(t)) { metric = 'quake_max_mag'; op = '>='; value = 4.5; }
  if (/wind|gust/.test(t)) { metric = 'wind_gust_kmh'; op = '>='; value = 60; }
  if (/severe|urgent|danger/.test(t)) severity = 'severe';
  else if (/warn/.test(t)) severity = 'warning';
  return {
    rule: { id: nid('rule'), name: text.slice(0, 48), when: { mode: 'all', conditions: [{ metric, op, value }] }, severity, message: text, cooldownMin: 360 },
    via: 'plain words'
  };
}

/* ---------- routes ---------- */

const ROUTES = [];
function on(method, pattern, fn) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  ROUTES.push({ method, re, keys, fn });
}

on('GET', '/api/state', () => clone(S));
on('GET', '/api/situation', () => clone(S.situation));
on('GET', '/api/cap/:alertId', () => ({ ok: true, text: 'Demo official alert text.' }));
// The demo router ignores the ?q= part, so this returns a fixed short list.
on('GET', '/api/places', () => ({ places: [
  { name: 'Raipur', state: 'Chhattisgarh', country: 'IN', lat: 21.2514, lon: 81.6296, label: 'Raipur, Chhattisgarh, IN' },
  { name: 'Kochi', state: 'Kerala', country: 'IN', lat: 9.9312, lon: 76.2673, label: 'Kochi, Kerala, IN' },
] }));

on('POST', '/api/agents', (_, b) => {
  if (b.templateId) {
    const t = S.templates.find((x) => x.id === b.templateId);
    if (!t) fail('Template not found');
    const a = { ...clone(t.agent), id: nid('agent'), createdAt: now(), templateId: t.id };
    S.agents.push(a);
    return clone(a);
  }
  const p = personaById(b.personaId);
  if (!p) fail('Pick a persona');
  const a = {
    id: nid('agent'), name: (b.name || p.name).trim(), avatar: p.avatar, personaId: p.id, genre: b.genre || 'custom',
    enabled: b.awake !== false, watch: [], place: b.place || null, members: b.members || [], everyMin: 30,
    rules: [], channels: b.channels || ['beacon'], pipeline: [], createdAt: now()
  };
  if (b.look) a.look = b.look;
  S.agents.push(a);
  return clone(a);
});

on('PUT', '/api/agents/:id', (p, b) => {
  const a = findAgent(p.id);
  Object.keys(b || {}).forEach((k) => { if (k !== 'id') a[k] = b[k]; });
  return clone(a);
});

on('DELETE', '/api/agents/:id', (p) => {
  findAgent(p.id);
  S.agents = S.agents.filter((x) => x.id !== p.id);
  return { ok: true };
});

on('POST', '/api/agents/:id/toggle', (p) => {
  const a = findAgent(p.id);
  a.enabled = !a.enabled;
  return clone(a);
});

on('POST', '/api/agents/:id/run', (p) => {
  const a = findAgent(p.id);
  const nodes = a.pipeline || [];
  const results = nodes.map((n) => ({ nodeId: n.id, ok: true, items: Math.floor(Math.random() * 4) + 1, ms: 40 + Math.floor(Math.random() * 200) }));
  const signals = Math.random() < 0.3 ? 1 : 0;
  const items = results.reduce((s, r) => s + r.items, 0);
  S.runs.unshift({ at: now(), agentId: a.id, ok: true, message: signals ? 'Checked. One thing needs a look.' : 'Checked. Nothing to report.', signals });
  return { signals, items, results };
});

on('PUT', '/api/agents/:id/pipeline', (p, b) => {
  const a = findAgent(p.id);
  a.pipeline = (b.nodes || []).map((n) => ({ ...n, id: n.id || nid('node') }));
  return clone(a);
});

on('POST', '/api/agents/:id/nodes/test', (p, b) => {
  const a = findAgent(p.id);
  const item = feedItem('t' + now(), a.id, a.name, 'news', 'info', 'Test item from ' + (b.node && b.node.label || 'node'), 'This is a test item from the node.', 0, ['test']);
  return { items: [item], result: { nodeId: (b.node && b.node.id) || 'test', ok: true, items: 1, ms: 52 } };
});

on('POST', '/api/agents/:id/rules', (p, b) => {
  const a = findAgent(p.id);
  if (!b.text || !String(b.text).trim()) fail('Write the rule in a few words');
  const out = parseRuleText(String(b.text).trim());
  a.rules = [...(a.rules || []), out.rule];
  return out;
});

on('DELETE', '/api/agents/:id/rules/:ruleId', (p) => {
  const a = findAgent(p.id);
  a.rules = (a.rules || []).filter((r) => r.id !== p.ruleId);
  return { ok: true };
});

on('POST', '/api/tick', () => ({ alerts: 0 }));

on('POST', '/api/approve', (_, b) => {
  if (S.pending && S.pending.id === b.id) S.pending = null;
  return { ok: true };
});

on('PUT', '/api/gateway/routes', (_, b) => {
  S.gateway.routes = b.routes || [];
  return { routes: clone(S.gateway.routes) };
});

on('POST', '/api/gateway/preview', () => ({
  matches: S.gateway.routes.filter((r) => r.enabled).slice(0, 2).map((r) => ({
    routeId: r.id, routeName: r.name, recipients: S.members.slice(0, 2), telegram: !!(r.to && r.to.telegram), notify: true
  }))
}));

on('POST', '/api/gateway/flush', (_, b) => {
  const d = (S.gateway.digests || []).find((x) => x.routeId === b.routeId);
  if (!d || !d.queued) return { flushed: [] };
  const items = d.queued;
  d.queued = 0;
  d.lastFlush = now();
  d.nextAt = now() + d.everyMin * MIN;
  return { flushed: [{ routeId: d.routeId, items, phones: S.group.members.filter((m) => m.deviceId).length, telegram: false }] };
});

on('POST', '/api/gateway/send-test', () => ({ delivered: S.group.members.filter((m) => m.deviceId).length }));

on('POST', '/api/members', (_, b) => {
  if (!b.name) fail('Give the member a name');
  const m = { id: nid('member'), name: b.name, role: b.role || 'elder', healthName: b.healthName, look: b.look, joinedAt: null };
  S.group.members.push(m);
  return clone(m);
});

on('PUT', '/api/members/:id', (p, b) => {
  const m = S.group.members.find((x) => x.id === p.id);
  if (!m) fail('Member not found');
  Object.assign(m, b);
  return clone(m);
});

on('DELETE', '/api/members/:id', (p) => {
  S.group.members = S.group.members.filter((x) => x.id !== p.id);
  return { ok: true };
});

on('POST', '/api/members/:id/invite', () => {
  const code = 'LION-' + Math.floor(10 + Math.random() * 89);
  return { code, expiresAt: now() + 24 * HOUR, qr: qrDataUrl(code), payload: JSON.stringify({ v: 2, hub: 'demo-hub', invite: code }) };
});

on('POST', '/api/joins/:deviceId/approve', (p, b) => {
  const j = S.group.pendingJoins.find((x) => x.deviceId === p.deviceId);
  if (!j) fail('That phone is not waiting');
  S.group.pendingJoins = S.group.pendingJoins.filter((x) => x.deviceId !== p.deviceId);
  const m = { id: nid('member'), name: b.name || j.name, role: b.role || 'elder', deviceId: j.deviceId, joinedAt: now() };
  S.group.members.push(m);
  return clone(m);
});

on('DELETE', '/api/joins/:deviceId', (p) => {
  S.group.pendingJoins = S.group.pendingJoins.filter((x) => x.deviceId !== p.deviceId);
  return { ok: true };
});

on('POST', '/api/chat', (_, b) => {
  if (!b.text || !String(b.text).trim()) fail('Write a message first');
  const m = { id: nid('msg'), from: 'hub', fromName: 'Desktop', text: String(b.text).trim(), kind: 'text', at: now() };
  S.group.messages.push(m);
  S.group.messages = S.group.messages.slice(-200);
  return clone(m);
});

on('POST', '/api/asks/:id', (p, b) => {
  const k = S.group.asks.find((x) => x.id === p.id);
  if (!k) fail('That question is gone');
  k.status = b.answer === 'approve' ? 'answered' : 'denied';
  if (b.answer === 'approve') k.answer = 'Yes, it looks fine for now.';
  return clone(k);
});

on('PUT', '/api/settings', (_, b) => {
  if (typeof b.allowAdultAsks === 'boolean') S.group.allowAdultAsks = b.allowAdultAsks;
  if (b.openWeatherKey !== undefined && String(b.openWeatherKey).trim() !== '') S.connections.openWeather = { hasKey: true, hint: 'Saved (ends ...demo)' };
  if (b.removeOpenWeatherKey === true) S.connections.openWeather = { hasKey: false, hint: '' };
  return { allowAdultAsks: S.group.allowAdultAsks, openWeather: S.connections.openWeather };
});

on('POST', '/api/owm/test', () => (S.connections.openWeather.hasKey
  ? { ok: true, ms: 214 }
  : { ok: false, ms: 0, error: 'Add your OpenWeather key in Connections' }));

on('POST', '/api/mcp', (_, b) => {
  if (!b.name) fail('Give the server a name');
  const spec = { id: nid('mcp'), name: b.name, transport: b.transport || 'stdio', command: b.command, args: b.args || [], env: b.env || {}, url: b.url, headers: b.headers || {}, enabled: true };
  S.mcp.servers.push(spec);
  S.mcp.status.push({ id: spec.id, connected: false, toolCount: 0 });
  return clone(spec);
});

on('PUT', '/api/mcp/:id', (p, b) => {
  const s = S.mcp.servers.find((x) => x.id === p.id);
  if (!s) fail('Server not found');
  Object.assign(s, b);
  return clone(s);
});

on('DELETE', '/api/mcp/:id', (p) => {
  S.mcp.servers = S.mcp.servers.filter((x) => x.id !== p.id);
  S.mcp.status = S.mcp.status.filter((x) => x.id !== p.id);
  S.mcp.tools = S.mcp.tools.filter((x) => x.server !== p.id);
  return { ok: true };
});

on('POST', '/api/mcp/:id/connect', (p) => {
  const s = S.mcp.servers.find((x) => x.id === p.id);
  if (!s) fail('Server not found');
  const tools = 2 + Math.floor(Math.random() * 3);
  const st = S.mcp.status.find((x) => x.id === p.id);
  if (st) Object.assign(st, { connected: true, toolCount: tools, error: undefined });
  return { ok: true, tools };
});

on('POST', '/api/mcp/test', (_, b) => {
  const spec = b.spec || {};
  if (/bad|refused|0\.0\.0\.0:1/.test(spec.url || spec.command || '')) return { ok: false, tools: 0, error: 'Connection refused. Is the server running?' };
  return { ok: true, tools: 3 };
});

on('POST', '/api/mcp/:id/call', (p, b) => ({ result: { text: 'Demo result from ' + b.tool + '.' } }));

on('POST', '/api/health/csv', () => ({ ok: true, rows: 12 }));
on('POST', '/api/health/reading', () => ({ ok: true }));
on('POST', '/api/telegram/token', () => ({ bot: 'beacon_family_bot', telegram: S.connections.telegram }));
on('POST', '/api/telegram/retry', () => ({ telegram: S.connections.telegram }));
on('DELETE', '/api/telegram/token', () => {
  S.connections.telegram = { ...S.connections.telegram, state: 'none', connected: false, bot: '', saved: false, hint: '' };
  return { telegram: S.connections.telegram };
});
on('POST', '/api/telegram/pair', () => ({ code: 'LION-42', bot: 'beacon_family_bot' }));
on('PUT', '/api/telegram/mode', (_, b) => {
  S.connections.telegram = { ...S.connections.telegram, mode: b.mode === 'relay' ? 'relay' : 'direct' };
  return { telegram: S.connections.telegram };
});
on('POST', '/api/telegram/test', () => ({ ok: true, note: 'Sent to your paired chats.' }));
on('POST', '/api/beacon/pair', () => ({ code: 'PAIR-31', expiresAt: now() + 10 * MIN, qr: qrDataUrl('PAIR-31') }));
on('POST', '/api/brain', (_, b) => {
  S.connections.brain = { kind: b.kind || 'none', ok: true };
  return { ok: true };
});

/* ---------- entry point ---------- */

/** Fake request. Resolves with the body, rejects with an Error (message from the hub). */
export async function handle(method, path, body) {
  await delay();
  const clean = path.split('?')[0];
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.re.exec(clean);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return r.fn(params, body || {});
  }
  const e = new Error('Not in the demo: ' + method + ' ' + clean);
  e.status = 404;
  throw e;
}
