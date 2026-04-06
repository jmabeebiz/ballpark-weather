/**
 * api/games.js
 * Vercel serverless function.
 * Fetches today's MLB schedule, maps ballpark coordinates,
 * pulls hourly weather from Visual Crossing, scores each game.
 */

const { calculateRainoutRisk, ROOF_TYPE } = require('../lib/rainout-risk');

// ── Ballpark coordinates and metadata ────────────────────────────────────────
const BALLPARKS = {
  ARI: { name: 'Chase Field',               city: 'Phoenix, AZ',       lat: 33.4453, lon: -112.0667 },
  ATL: { name: 'Truist Park',               city: 'Cumberland, GA',    lat: 33.8908, lon: -84.4678  },
  BAL: { name: 'Oriole Park',               city: 'Baltimore, MD',     lat: 39.2838, lon: -76.6218  },
  BOS: { name: 'Fenway Park',               city: 'Boston, MA',        lat: 42.3467, lon: -71.0972  },
  CHC: { name: 'Wrigley Field',             city: 'Chicago, IL',       lat: 41.9484, lon: -87.6553  },
  CWS: { name: 'Guaranteed Rate Field',     city: 'Chicago, IL',       lat: 41.8299, lon: -87.6338  },
  CIN: { name: 'Great American Ball Park',  city: 'Cincinnati, OH',    lat: 39.0979, lon: -84.5082  },
  CLE: { name: 'Progressive Field',         city: 'Cleveland, OH',     lat: 41.4962, lon: -81.6852  },
  COL: { name: 'Coors Field',               city: 'Denver, CO',        lat: 39.7559, lon: -104.9942 },
  DET: { name: 'Comerica Park',             city: 'Detroit, MI',       lat: 42.3390, lon: -83.0485  },
  HOU: { name: 'Minute Maid Park',          city: 'Houston, TX',       lat: 29.7573, lon: -95.3555  },
  KC:  { name: 'Kauffman Stadium',          city: 'Kansas City, MO',   lat: 39.0517, lon: -94.4803  },
  LAA: { name: 'Angel Stadium',             city: 'Anaheim, CA',       lat: 33.8003, lon: -117.8827 },
  LAD: { name: 'Dodger Stadium',            city: 'Los Angeles, CA',   lat: 34.0739, lon: -118.2400 },
  MIA: { name: 'loanDepot Park',            city: 'Miami, FL',         lat: 25.7781, lon: -80.2197  },
  MIL: { name: 'American Family Field',     city: 'Milwaukee, WI',     lat: 43.0280, lon: -87.9712  },
  MIN: { name: 'Target Field',              city: 'Minneapolis, MN',   lat: 44.9817, lon: -93.2781  },
  NYM: { name: 'Citi Field',               city: 'Flushing, NY',      lat: 40.7571, lon: -73.8458  },
  NYY: { name: 'Yankee Stadium',            city: 'Bronx, NY',         lat: 40.8296, lon: -73.9262  },
  OAK: { name: 'Sacramento Sutter Health Park', city: 'Sacramento, CA', lat: 38.5803, lon: -121.5086 },
  PHI: { name: 'Citizens Bank Park',        city: 'Philadelphia, PA',  lat: 39.9061, lon: -75.1665  },
  PIT: { name: 'PNC Park',                  city: 'Pittsburgh, PA',    lat: 40.4469, lon: -80.0057  },
  SD:  { name: 'Petco Park',               city: 'San Diego, CA',     lat: 32.7076, lon: -117.1570 },
  SF:  { name: 'Oracle Park',              city: 'San Francisco, CA', lat: 37.7786, lon: -122.3893 },
  SEA: { name: 'T-Mobile Park',            city: 'Seattle, WA',       lat: 47.5914, lon: -122.3325 },
  STL: { name: 'Busch Stadium',            city: 'St. Louis, MO',     lat: 38.6226, lon: -90.1928  },
  TB:  { name: 'Tropicana Field',          city: 'St. Petersburg, FL',lat: 27.7683, lon: -82.6534  },
  TEX: { name: 'Globe Life Field',         city: 'Arlington, TX',     lat: 32.7473, lon: -97.0845  },
  TOR: { name: 'Rogers Centre',            city: 'Toronto, ON',       lat: 43.6414, lon: -79.3894  },
  WSH: { name: 'Nationals Park',           city: 'Washington, DC',    lat: 38.8730, lon: -77.0074  },
};

// MLB team ID -> abbreviation map (verified from MLB Stats API)
const TEAM_ID_TO_ABBR = {
  109: 'ARI', 144: 'ATL', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  145: 'CWS', 113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET',
  117: 'HOU', 118: 'KC',  108: 'LAA', 119: 'LAD', 146: 'MIA',
  158: 'MIL', 142: 'MIN', 121: 'NYM', 147: 'NYY', 133: 'OAK',
  143: 'PHI', 134: 'PIT', 135: 'SD',  137: 'SF',  136: 'SEA',
  138: 'STL', 139: 'TB',  140: 'TEX', 141: 'TOR', 120: 'WSH',
};

// Fallback: build abbreviation from team name if ID not in map
function getAbbrFromName(name = '') {
  const n = name.toUpperCase();
  if (n.includes('ARIZONA'))       return 'ARI';
  if (n.includes('ATLANTA'))       return 'ATL';
  if (n.includes('BALTIMORE'))     return 'BAL';
  if (n.includes('BOSTON'))        return 'BOS';
  if (n.includes('CUBS'))          return 'CHC';
  if (n.includes('WHITE SOX'))     return 'CWS';
  if (n.includes('CINCINNATI'))    return 'CIN';
  if (n.includes('CLEVELAND'))     return 'CLE';
  if (n.includes('COLORADO'))      return 'COL';
  if (n.includes('DETROIT'))       return 'DET';
  if (n.includes('HOUSTON'))       return 'HOU';
  if (n.includes('KANSAS CITY'))   return 'KC';
  if (n.includes('ANGELS'))        return 'LAA';
  if (n.includes('DODGERS'))       return 'LAD';
  if (n.includes('MIAMI') || n.includes('MARLINS')) return 'MIA';
  if (n.includes('MILWAUKEE'))     return 'MIL';
  if (n.includes('MINNESOTA'))     return 'MIN';
  if (n.includes('METS'))          return 'NYM';
  if (n.includes('YANKEES'))       return 'NYY';
  if (n.includes('ATHLETICS'))     return 'OAK';
  if (n.includes('PHILADELPHIA') || n.includes('PHILLIES')) return 'PHI';
  if (n.includes('PITTSBURGH') || n.includes('PIRATES'))    return 'PIT';
  if (n.includes('SAN DIEGO') || n.includes('PADRES'))      return 'SD';
  if (n.includes('SAN FRANCISCO') || n.includes('GIANTS'))  return 'SF';
  if (n.includes('SEATTLE') || n.includes('MARINERS'))      return 'SEA';
  if (n.includes('ST. LOUIS') || n.includes('CARDINALS'))   return 'STL';
  if (n.includes('TAMPA BAY') || n.includes('RAYS'))        return 'TB';
  if (n.includes('TEXAS') || n.includes('RANGERS'))         return 'TEX';
  if (n.includes('TORONTO') || n.includes('BLUE JAYS'))     return 'TOR';
  if (n.includes('WASHINGTON') || n.includes('NATIONALS'))  return 'WSH';
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayEST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function gameStartHour(dateTimeUTC, timeZone) {
  if (!dateTimeUTC) return 19;
  const d = new Date(dateTimeUTC);
  return parseInt(d.toLocaleString('en-US', { timeZone, hour: 'numeric', hour12: false }), 10);
}

// Map IANA timezone from state/province
function tzForCity(city = '') {
  const c = city.toLowerCase();
  if (c.includes('ak')) return 'America/Anchorage';
  if (c.includes(', hi')) return 'Pacific/Honolulu';
  if (c.includes(', ca') || c.includes(', wa') || c.includes(', or')) return 'America/Los_Angeles';
  if (c.includes(', az')) return 'America/Phoenix';
  if (c.includes(', co') || c.includes(', tx') || c.includes(', mo') ||
      c.includes(', mn') || c.includes(', ok') || c.includes(', ks') ||
      c.includes(', wi') || c.includes(', il')) return 'America/Chicago';
  if (c.includes('on')) return 'America/Toronto';
  return 'America/New_York';
}

function conditionFromIcon(icon = '') {
  const i = icon.toLowerCase();
  if (i.includes('thunder')) return 'Thunderstorm';
  if (i.includes('snow'))    return 'Snow';
  if (i.includes('rain') && (i.includes('heavy') || i.includes('showers'))) return 'Heavy Rain';
  if (i.includes('rain') || i.includes('drizzle')) return 'Rain';
  if (i.includes('overcast') || i.includes('cloudy')) return 'Overcast';
  if (i.includes('fog'))  return 'Fog';
  return 'Clear';
}

// ── MLB Schedule fetch ────────────────────────────────────────────────────────

async function fetchRawSchedule(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,venue,game(content(summary))`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);
  return res.json();
}

async function fetchSchedule(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,venue,game(content(summary))`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);
  const data = await res.json();
  const games = [];
  for (const dateObj of (data.dates || [])) {
    for (const g of (dateObj.games || [])) {
      if (g.status?.abstractGameState === 'Final') continue; // skip completed games
      const homeId   = g.teams?.home?.team?.id;
      const awayId   = g.teams?.away?.team?.id;
      const homeName = g.teams?.home?.team?.name ?? '';
      const awayName = g.teams?.away?.team?.name ?? '';
      const homeAbbr = TEAM_ID_TO_ABBR[homeId] ?? getAbbrFromName(homeName);
      const awayAbbr = TEAM_ID_TO_ABBR[awayId] ?? getAbbrFromName(awayName);
      if (!homeAbbr || !awayAbbr) {
        console.warn('Unknown team IDs:', awayId, awayName, 'vs', homeId, homeName);
        continue;
      }
      games.push({
        gamePk:       g.gamePk,
        homeAbbr,
        awayAbbr,
        homeFull:     g.teams?.home?.team?.name ?? homeAbbr,
        awayFull:     g.teams?.away?.team?.name ?? awayAbbr,
        gameDateTime: g.gameDate,
        status:       g.status?.detailedState ?? 'Scheduled',
      });
    }
  }
  return games;
}

// ── Visual Crossing weather fetch ─────────────────────────────────────────────

async function fetchWeather(lat, lon, date, apiKey) {
  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/${date}?unitGroup=us&include=hours&key=${apiKey}&contentType=json`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status} for ${lat},${lon}`);
  return res.json();
}

// ── Score a single game ───────────────────────────────────────────────────────

function scoreGame(game, weatherData, ballpark) {
  const tz        = tzForCity(ballpark.city);
  const startHour = gameStartHour(game.gameDateTime, tz);
  const hours     = weatherData?.days?.[0]?.hours ?? [];

  // Find the hour slot matching first pitch
  const fpHour = hours.find(h => {
    const hNum = parseInt(h.datetime?.split(':')?.[0] ?? '19', 10);
    return hNum === startHour;
  }) ?? hours[Math.min(startHour, hours.length - 1)] ?? {};

  // Build 4-hour forecast window starting at first pitch
  const startIdx = hours.findIndex(h =>
    parseInt(h.datetime?.split(':')?.[0] ?? '0', 10) === startHour
  );
  const windowHours = startIdx >= 0
    ? hours.slice(startIdx, startIdx + 4)
    : hours.slice(18, 22);

  const weather = {
    precipProb:   fpHour.precipprob   ?? 0,
    precipAmount: fpHour.precip       ?? 0,
    condition:    conditionFromIcon(fpHour.icon ?? fpHour.conditions ?? ''),
    windSpeed:    fpHour.windspeed    ?? 0,
    temp:         fpHour.temp         ?? 70,
  };

  const forecastWindow = windowHours.map(h => ({
    precipProb: h.precipprob ?? 0,
    condition:  conditionFromIcon(h.icon ?? h.conditions ?? ''),
  }));

  const result = calculateRainoutRisk(weather, { homeTeam: game.homeAbbr, startHour }, forecastWindow);

  // Build display time string
  const dtLocal = game.gameDateTime
    ? new Date(game.gameDateTime).toLocaleTimeString('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : 'TBD';

  // Timezone label
  const tzLabel = tz.includes('Los_Angeles') ? 'PT'
    : tz.includes('Chicago') ? 'CT'
    : tz.includes('Phoenix') ? 'MT'
    : tz.includes('Toronto') ? 'ET'
    : 'ET';

  return {
    gamePk:      game.gamePk,
    away:        game.awayAbbr,
    awayFull:    game.awayFull,
    home:        game.homeAbbr,
    homeFull:    game.homeFull,
    time:        `${dtLocal} ${tzLabel}`,
    venue:       `${ballpark.name} · ${ballpark.city}`,
    roofType:    result.breakdown.roofType,
    tags:        buildTags(result.breakdown.roofType, weather.condition),
    wx: {
      rain:  `${Math.round(weather.precipProb)}%`,
      temp:  `${Math.round(weather.temp)}°`,
      wind:  `${Math.round(weather.windSpeed)} mph`,
    },
    score:       result.score,
    tier:        result.tier.toLowerCase(),
    tierLabel:   result.tier,
    sublabel:    result.label,
    sustained:   result.sustained && result.score >= 70 ? 'Rain all game' : null,
    status:      game.status,
  };
}

function buildTags(roofType, condition) {
  const tags = [];
  if (roofType === 'fixed')       tags.push('Fixed dome');
  else if (roofType === 'retractable') tags.push('Retractable roof');
  else tags.push('Open air');

  const c = condition.toLowerCase();
  if (c.includes('thunderstorm')) tags.push('Thunderstorms');
  else if (c.includes('heavy rain')) tags.push('Heavy rain');
  else if (c.includes('rain'))    tags.push('Rain');
  else if (c.includes('snow'))    tags.push('Snow');
  return tags;
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=300');

  try {
    const apiKey = process.env.VISUAL_CROSSING_API_KEY;
    if (!apiKey) throw new Error('Missing VISUAL_CROSSING_API_KEY');

    const date  = req.query.date || todayEST();
    const rawSchedule = await fetchRawSchedule(date);
    const allGames = rawSchedule?.dates?.[0]?.games ?? [];
    
    console.log('Raw MLB games count:', allGames.length);
    allGames.forEach(g => {
      const homeId = g.teams?.home?.team?.id;
      const awayId = g.teams?.away?.team?.id;
      const homeName = g.teams?.home?.team?.name;
      const awayName = g.teams?.away?.team?.name;
      const state = g.status?.abstractGameState;
      console.log(`  ${awayId} ${awayName} @ ${homeId} ${homeName} [${state}]`);
    });

    const games = await fetchSchedule(date);

    if (!games.length) {
      return res.status(200).json({ date, games: [], count: 0 });
    }

    // Deduplicate weather fetches — multiple games at the same park on the same day
    const uniqueTeams = [...new Set(games.map(g => g.homeAbbr))];
    const weatherMap  = {};

    await Promise.all(uniqueTeams.map(async abbr => {
      const bp = BALLPARKS[abbr];
      if (!bp) return;
      try {
        weatherMap[abbr] = await fetchWeather(bp.lat, bp.lon, date, apiKey);
      } catch (e) {
        console.error(`Weather fetch failed for ${abbr}:`, e.message);
        weatherMap[abbr] = null;
      }
    }));

    const scored = games
      .map(game => {
        const bp = BALLPARKS[game.homeAbbr];
        if (!bp || !weatherMap[game.homeAbbr]) return null;
        try {
          return scoreGame(game, weatherMap[game.homeAbbr], bp);
        } catch (e) {
          console.error(`Scoring failed for ${game.homeAbbr}:`, e.message);
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score); // highest risk first

    return res.status(200).json({ date, games: scored, count: scored.length });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
