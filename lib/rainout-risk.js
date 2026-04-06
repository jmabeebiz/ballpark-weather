/**
 * lib/rainout-risk.js
 * Rainout risk scoring model.
 */

const ROOF_TYPE = {
  FIXED:       'fixed',
  RETRACTABLE: 'retractable',
  OPEN:        'open',
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

function getTimeOfDayMultiplier(gameTimeHour) {
  if (gameTimeHour < 13) return 1.00;
  if (gameTimeHour < 17) return 1.20;
  if (gameTimeHour < 19) return 1.08;
  return 1.00;
}

function scorePrecipProb(prob) {
  if (prob < 20) return 0;
  if (prob < 40) return 25;
  if (prob < 60) return 50;
  if (prob < 80) return 75;
  return 100;
}

function scorePrecipAmount(inches) {
  if (inches === 0)  return 0;
  if (inches < 0.10) return 20;
  if (inches < 0.25) return 50;
  if (inches < 0.50) return 75;
  return 100;
}

function scoreCondition(condition) {
  const c = condition?.toLowerCase() ?? '';
  if (c.includes('thunderstorm')) return 100;
  if (c.includes('snow'))         return 90;
  if (c.includes('heavy rain'))   return 75;
  if (c.includes('rain'))         return 65;
  if (c.includes('drizzle'))      return 40;
  if (c.includes('overcast'))     return 25;
  if (c.includes('fog'))          return 15;
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

function getRiskTier(score) {
  if (score <= 20) return { tier: 'Low',      label: 'Play expected'       };
  if (score <= 40) return { tier: 'Moderate', label: 'Watch conditions'    };
  if (score <= 69) return { tier: 'High',     label: 'Delay likely'        };
  return           { tier: 'Severe',          label: 'Postponement likely' };
}

function detectSustainedRain(forecastWindow = []) {
  if (!forecastWindow.length) return false;
  const highProbHours  = forecastWindow.filter(h => h.precipProb >= 70).length;
  const majorityWet    = highProbHours / forecastWindow.length > 0.5;
  const seriousCondition = forecastWindow.some(h => {
    const c = h.condition?.toLowerCase() ?? '';
    return c.includes('rain') || c.includes('thunderstorm') || c.includes('snow');
  });
  return majorityWet && seriousCondition;
}

function calculateRainoutRisk(weather, game, forecastWindow = []) {
  const {
    precipProb   = 0,
    precipAmount = 0,
    condition    = '',
    windSpeed    = 0,
    temp         = 70,
  } = weather;

  const { homeTeam = '', startHour = 19 } = game;

  const roofType = getRoofType(homeTeam);

  if (roofType === ROOF_TYPE.FIXED) {
    return {
      score: 0, sustained: false,
      ...getRiskTier(0),
      breakdown: { note: 'Fixed dome -- weather not a factor', roofType },
    };
  }

  const components = {
    precipProbScore:   scorePrecipProb(precipProb),
    precipAmountScore: scorePrecipAmount(precipAmount),
    conditionScore:    scoreCondition(condition),
    windScore:         scoreWind(windSpeed),
    tempScore:         scoreTemp(temp),
  };

  let score =
    components.precipProbScore   * 0.40 +
    components.precipAmountScore * 0.30 +
    components.conditionScore    * 0.20 +
    components.windScore         * 0.05 +
    components.tempScore         * 0.05;

  const timeMultiplier = getTimeOfDayMultiplier(startHour);
  score = score * timeMultiplier;

  const isThunderstorm = condition?.toLowerCase().includes('thunderstorm');
  if (isThunderstorm) score = Math.min(100, score * 1.3);

  if (roofType === ROOF_TYPE.RETRACTABLE) score = score * 0.30;

  const sustained = detectSustainedRain(forecastWindow);
  if (!sustained) score = Math.min(69, score);

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
