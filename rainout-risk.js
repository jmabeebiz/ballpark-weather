/**
 * rainout-risk.js
 * Ballpark weather rainout risk scoring model.
 *
 * Key design principle: the score reflects the entire game window (first pitch
 * + 3 hours), not just conditions at first pitch. Postponements require
 * sustained bad weather; delays happen when rain is heavy at start but clearing.
 */

// --- Stadium Roof Data -------------------------------------------------------

const ROOF_TYPE = {
  FIXED:       "fixed",       // Always covered -> score forced to 0
  RETRACTABLE: "retractable", // Typically closed in rain -> score reduced 70%
  OPEN:        "open",        // Full score applies
};

const STADIUM_ROOF = {
  TB:  ROOF_TYPE.FIXED,
  TOR: ROOF_TYPE.FIXED,
  ARI: ROOF_TYPE.RETRACTABLE,
  MIA: ROOF_TYPE.RETRACTABLE,
  MIL: ROOF_TYPE.RETRACTABLE,
  SEA: ROOF_TYPE.RETRACTABLE,
  HOU: ROOF_TYPE.RETRACTABLE,
  TEX: ROOF_TYPE.RETRACTABLE,
};

function getRoofType(homeTeam) {
  return STADIUM_ROOF[homeTeam?.toUpperCase()] ?? ROOF_TYPE.OPEN;
}

// --- Risk Tiers --------------------------------------------------------------
//
//   0-20   Low       Play expected
//  21-40   Moderate  Watch conditions
//  41-69   High      Delay likely
//  70-100  Severe    Postponement likely
//
// Severe requires both a high score AND the sustainedRain flag to be true.
// Without sustained rain, score is capped at 69 (top of High) regardless.

function getRiskTier(score) {
  if (score <= 20) return { tier: "Low",      label: "Play expected",       color: "#22c55e" };
  if (score <= 40) return { tier: "Moderate", label: "Watch conditions",    color: "#eab308" };
  if (score <= 69) return { tier: "High",     label: "Delay likely",        color: "#f97316" };
  return           { tier: "Severe",          label: "Postponement likely", color: "#ef4444" };
}

// --- Time-of-Day Multiplier --------------------------------------------------
// Applied to the final weighted score. Afternoon games fall in the peak
// convective storm window where forecasts carry the most uncertainty.

function getTimeOfDayMultiplier(gameTimeHour) {
  if (gameTimeHour < 13) return 1.00;  // Morning -- stable
  if (gameTimeHour < 17) return 1.20;  // 1-4:59 PM -- peak convective window
  if (gameTimeHour < 19) return 1.08;  // 5-6:59 PM -- shoulder
  return 1.00;                         // 7 PM+ -- night game, base weight
}

// --- Component Scorers (each returns 0-100) ----------------------------------

function scorePrecipProb(prob) {
  if (prob < 20) return 0;
  if (prob < 40) return 25;
  if (prob < 60) return 50;
  if (prob < 80) return 75;
  return 100;
}

function scorePrecipAmount(inches) {
  if (inches === 0)   return 0;
  if (inches < 0.10)  return 20;
  if (inches < 0.25)  return 50;
  if (inches < 0.50)  return 75;
  return 100;
}

function scoreCondition(condition) {
  const c = condition?.toLowerCase() ?? "";
  if (c.includes("thunderstorm")) return 100;
  if (c.includes("snow"))         return 90;
  if (c.includes("heavy rain"))   return 75;
  if (c.includes("rain"))         return 65;
  if (c.includes("drizzle"))      return 40;
  if (c.includes("overcast"))     return 25;
  if (c.includes("fog"))          return 15;
  return 0;
}

function scoreWind(mph) {
  if (mph < 15) return 0;
  if (mph < 25) return 30;
  if (mph < 35) return 60;
  return 100;
}

function scoreTemp(fahrenheit) {
  if (fahrenheit >= 45) return 0;
  if (fahrenheit >= 35) return 40;
  return 80;
}

// --- Sustained Rain Detection ------------------------------------------------
// Determines whether rain is expected to persist through the game window
// (first pitch + ~3 hours). This is the primary gate for Severe tier.
//
// forecastWindow: array of hourly snapshots covering game time + 3 hours.
// Each entry: { precipProb: number, condition: string }
//
// sustainedRain = true if the MAJORITY of the window hours have precipProb >= 70
// AND at least one hour has a serious condition (rain/thunderstorm).

function detectSustainedRain(forecastWindow = []) {
  if (!forecastWindow.length) return false;

  const highProbHours = forecastWindow.filter(h => h.precipProb >= 70).length;
  const majorityWet   = highProbHours / forecastWindow.length > 0.5;
  const seriousCondition = forecastWindow.some(h => {
    const c = h.condition?.toLowerCase() ?? "";
    return c.includes("rain") || c.includes("thunderstorm") || c.includes("snow");
  });

  return majorityWet && seriousCondition;
}

// --- Main Export -------------------------------------------------------------

/**
 * calculateRainoutRisk
 *
 * @param {Object} weather          - Conditions at/near first pitch
 *   @param {number} weather.precipProb      - Precip probability 0-100
 *   @param {number} weather.precipAmount    - Expected inches at game time
 *   @param {string} weather.condition       - Condition string from weather API
 *   @param {number} weather.windSpeed       - Wind speed in mph
 *   @param {number} weather.temp            - Temperature in F at first pitch
 *
 * @param {Object} game
 *   @param {string} game.homeTeam           - MLB team abbreviation (e.g. "PHI")
 *   @param {number} game.startHour          - Local start hour (0-23)
 *
 * @param {Array}  forecastWindow   - Hourly snapshots for game time + 3 hrs.
 *                                    Each: { precipProb: number, condition: string }
 *                                    If omitted, sustained rain cannot be confirmed
 *                                    and score is capped at High tier.
 *
 * @returns {Object}
 *   score     {number}  0-100 risk score
 *   tier      {string}  "Low" | "Moderate" | "High" | "Severe"
 *   label     {string}  Human-readable summary
 *   color     {string}  Hex color for UI
 *   sustained {boolean} Whether rain is expected to last through the game
 *   breakdown {Object}  Per-component detail for debugging or tooltips
 */
function calculateRainoutRisk(weather, game, forecastWindow = []) {
  const {
    precipProb   = 0,
    precipAmount = 0,
    condition    = "",
    windSpeed    = 0,
    temp         = 70,
  } = weather;

  const {
    homeTeam  = "",
    startHour = 19,
  } = game;

  // Fixed dome -- weather irrelevant
  const roofType = getRoofType(homeTeam);
  if (roofType === ROOF_TYPE.FIXED) {
    return {
      score: 0, sustained: false,
      ...getRiskTier(0),
      breakdown: { note: "Fixed dome -- weather not a factor" },
    };
  }

  // Component scores
  const components = {
    precipProbScore:   scorePrecipProb(precipProb),
    precipAmountScore: scorePrecipAmount(precipAmount),
    conditionScore:    scoreCondition(condition),
    windScore:         scoreWind(windSpeed),
    tempScore:         scoreTemp(temp),
  };

  // Weighted sum
  let score =
    components.precipProbScore   * 0.40 +
    components.precipAmountScore * 0.30 +
    components.conditionScore    * 0.20 +
    components.windScore         * 0.05 +
    components.tempScore         * 0.05;

  // Time-of-day multiplier applied to full score
  const timeMultiplier = getTimeOfDayMultiplier(startHour);
  score = score * timeMultiplier;

  // Thunderstorm override -- lightning stops play regardless
  const isThunderstorm = condition?.toLowerCase().includes("thunderstorm");
  if (isThunderstorm) {
    score = Math.min(100, score * 1.3);
  }

  // Retractable roof dampener
  if (roofType === ROOF_TYPE.RETRACTABLE) {
    score = score * 0.30;
  }

  // Sustained rain gate -- Severe tier requires confirmed multi-hour rain.
  // Without forecastWindow data or if rain is tapering, cap at top of High.
  const sustained = detectSustainedRain(forecastWindow);
  if (!sustained) {
    score = Math.min(69, score);
  }

  score = Math.round(Math.min(100, Math.max(0, score)));

  return {
    score,
    sustained,
    ...getRiskTier(score),
    breakdown: {
      ...components,
      timeMultiplier,
      roofType,
      isThunderstorm,
      sustainedRain: sustained,
      forecastHoursProvided: forecastWindow.length,
    },
  };
}

module.exports = { calculateRainoutRisk, getRoofType, getRiskTier, detectSustainedRain, ROOF_TYPE };
