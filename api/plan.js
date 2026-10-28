// Out Out server function. Keeps API keys off the page, adds real venues (optional) and a basic rate limit.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 36e5;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now); hits.set(ip, list);
  return list.length > (+process.env.RATE_LIMIT_PER_HOUR || 10);
}
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

const SCHEMA = 'Return ONLY minified JSON on a single line, with no markdown and no extra whitespace: {"title":str,"vibe":str,"stops":[{"time":"HH:MM","name":str,"area":str,"type":str,"why":str,"order":[str],"reviews":str,"costPerPerson":str,"bookAhead":bool,"mapsUrl":str}],"transport":[{"how":str,"minutes":number,"cost":str}] (one entry per leg between consecutive stops),"totalPerPerson":str,"tips":[str]}';
const RULES = "You are an expert local nightlife planner. Use real, well-known venues you are confident exist; never invent venues. Respect dislikes and the budget. Keep every stop within radiusKm of the location. Factor in the date: day of week, season, likely weather, sunset time, and any public holidays or events you are confident about, and say so if they change the night. Set stop times that leave room for the travel time of each leg. Finish by endTime if one is given. Give exactly 4 or 5 stops. Keep every text field to one short sentence, at most 2 items in each order list, so the whole JSON stays small and fast to write. Give at most 2 tips. For each stop give specific dishes or drinks to order and a fair summary of what reviewers generally say, with no fake ratings or quotes. If transport is 'MOST FUN', choose the most fun way to get between each stop (for example a tuk-tuk, a scenic walk, a ferry or a party bus, whatever genuinely exists in that area) and say why. If it is 'We have a designated driver', plan around one car, with parking and drop-off in mind, and make sure the driver has great non-alcoholic options at every stop.";

// Optional: real venues from Google Places (New). Skipped if GOOGLE_PLACES_API_KEY is not set.
async function venues(b) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(b.location);
  const bias = m ? { locationBias: { circle: { center: { latitude: +m[1], longitude: +m[2] }, radius: Math.min(50000, (+b.radiusKm || 5) * 1000) } } } : {};
  const where = m ? '' : ' near ' + b.location;
  const likes = b.likes ? clip(b.likes, 80) + ' ' : '';
  const queries = ['best bars' + where, 'best restaurants' + where, likes + 'nightlife' + where, 'late night food' + where];
  const mask = 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.regularOpeningHours.weekdayDescriptions,places.googleMapsUri';
  const results = await Promise.all(queries.map(q =>
    fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask },
      body: JSON.stringify({ textQuery: q, maxResultCount: 10, ...bias })
    }).then(r => r.ok ? r.json() : { places: [] }).catch(() => ({ places: [] }))
  ));
  const seen = new Set(), list = [];
  for (const r of results) for (const p of (r.places || [])) {
    const name = p.displayName && p.displayName.text;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    list.push({ name, address: p.formattedAddress, rating: p.rating, ratings: p.userRatingCount, price: p.priceLevel,
      hours: p.regularOpeningHours && p.regularOpeningHours.weekdayDescriptions, mapsUrl: p.googleMapsUri });
  }
  return list.length ? list.slice(0, 30) : null;
}

async function askClaude(prompt, started) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt ? prompt + '\nYour previous answer was too long. Make it much shorter: exactly 4 stops, a few words per field, one order item per stop, one tip.' : prompt;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.MODEL || 'claude-haiku-5-5', max_tokens: 5000, messages: [{ role: 'user', content: p }] })
    });
    if (!r.ok) throw new Error('Claude API ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    const canRetry = attempt === 0 && Date.now() - started < 25000;
    if (j.stop_reason === 'max_tokens') { if (canRetry) continue; throw new Error('plan was cut off'); }
    const text = (j.content || []).map(c => c.text || '').join('');
    try {
      return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch (e) {
      if (canRetry) continue;
      throw new Error('plan could not be read');
    }
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'That is a lot of plans. Try again in an hour.' });
  try {
    const body = req.body || {}, bi = body.brief || {};
    const b = {
      location: clip(bi.location, 120), date: clip(bi.date, 60), radiusKm: clip(bi.radiusKm, 3),
      likes: clip(bi.likes, 400), dislikes: clip(bi.dislikes, 400), budgetPerPerson: clip(bi.budgetPerPerson, 60),
      partySize: clip(bi.partySize, 3), startTime: clip(bi.startTime, 8), endTime: clip(bi.endTime, 80), transport: clip(bi.transport, 60)
    };
    if (!b.location.trim()) return res.status(400).json({ error: 'Add a location first.' });
    const started = Date.now();
    const list = await venues(b);
    let prompt = RULES + '\nBrief: ' + JSON.stringify(b);
    if (list) prompt += '\nReal venues near the location (from Google Places). Choose every stop ONLY from this list, respect opening hours for the date, and copy the matching mapsUrl into each stop:\n' + JSON.stringify(list);
    if (body.mode === 'tweak' && body.plan) {
      prompt += '\nCurrent plan: ' + JSON.stringify(body.plan).slice(0, 12000) + '\nChange requested: ' + clip(body.change, 300) +
        '\nMake only this change, keep everything else the same where possible, and recompute times, travel legs, costs and the total. Return the full updated plan.';
    }
    prompt += '\n' + (list ? SCHEMA : SCHEMA.replace(',"mapsUrl":str', ''));
    const plan = await askClaude(prompt, started);
    plan.live = !!list;
    (plan.stops || []).forEach(st => {
      if (!list || !/^https:\/\//.test(st.mapsUrl || '')) st.mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([st.name, st.area, b.location].filter(Boolean).join(' '));
    });
    res.status(200).json(plan);
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Could not build the plan (' + String(e.message).slice(0, 120) + '). Try again.' });
  }
};
