/**
 * bingo-format.js
 * Shared data format + logic for the Bingo Ride apps (Director + Rider).
 * No dependencies. Works fully offline. Import as an ES module:
 *
 *   import * as BingoFormat from './bingo-format.js';
 *
 * -----------------------------------------------------------------------
 * QR PAYLOAD FORMATS (all plain text, safe for any QR encoder)
 * -----------------------------------------------------------------------
 * Card string:      "C001:0107091214|1622273028|31384245|4750566058|6273667175"
 *                    <cardId>:<B 5x2digit>|<I 5x2digit>|<N 4x2digit>|<G 5x2digit>|<O 5x2digit>
 *
 * Issuance QR:       "BINGO1;<riderName>;<card1>;<card2>;<card3>"
 * Station QR:        "STA1|<stationNumber>|B07,I22,N38,G51,O66,N45"
 * Finish QR:         "FIN1|<riderName>|<cardId1>,<cardId2>,...|<6-digit visited mask>"
 * -----------------------------------------------------------------------
 */

export const LETTERS = ["B", "I", "N", "G", "O"];

export const RANGES = {
  B: [1, 15],
  I: [16, 30],
  N: [31, 45],
  G: [46, 60],
  O: [61, 75],
};

// ---------- helpers ----------

function pad2(n) {
  return String(n).padStart(2, "0");
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickN(min, max, n) {
  const pool = [];
  for (let v = min; v <= max; v++) pool.push(v);
  return shuffle(pool).slice(0, n);
}

// ---------- card generation ----------

export function generateCard(cardId) {
  return {
    id: cardId,
    B: pickN(RANGES.B[0], RANGES.B[1], 5),
    I: pickN(RANGES.I[0], RANGES.I[1], 5),
    N: pickN(RANGES.N[0], RANGES.N[1], 4),
    G: pickN(RANGES.G[0], RANGES.G[1], 5),
    O: pickN(RANGES.O[0], RANGES.O[1], 5),
  };
}

export function generateUniqueCards(count, startIndex = 1) {
  const cards = [];
  const seen = new Set();
  let idx = startIndex;
  while (cards.length < count) {
    const card = generateCard("C" + String(idx).padStart(3, "0"));
    const key = encodeCard(card).split(":")[1];
    if (!seen.has(key)) {
      seen.add(key);
      cards.push(card);
      idx++;
    }
  }
  return cards;
}

// ---------- encode / decode: card ----------

export function encodeCard(card) {
  const groups = LETTERS.map((L) => card[L].map(pad2).join(""));
  return `${card.id}:${groups.join("|")}`;
}

export function decodeCard(str) {
  const [id, rest] = str.split(":");
  const groups = rest.split("|");
  const card = { id };
  LETTERS.forEach((L, i) => {
    const digits = groups[i];
    const nums = [];
    for (let c = 0; c < digits.length; c += 2) {
      nums.push(parseInt(digits.slice(c, c + 2), 10));
    }
    card[L] = nums;
  });
  return card;
}

// ---------- encode / decode: issuance QR ----------

export function encodeIssuance(riderName, cards) {
  return ["BINGO1", riderName, ...cards.map(encodeCard)].join(";");
}

export function decodeIssuance(payload) {
  const parts = payload.split(";");
  if (parts[0] !== "BINGO1") throw new Error("Not a valid issuance QR");
  const riderName = parts[1];
  const cards = parts.slice(2).map(decodeCard);
  return { riderName, cards };
}

// ---------- encode / decode: station QR ----------

export function generateStations(numStations = 6, callsPerStation = 6) {
  const totalCalls = numStations * callsPerStation;
  const perLetter = Math.floor(totalCalls / LETTERS.length);
  const remainder = totalCalls - perLetter * LETTERS.length;

  let pool = [];
  LETTERS.forEach((L, i) => {
    const count = perLetter + (i < remainder ? 1 : 0);
    const nums = pickN(RANGES[L][0], RANGES[L][1], count);
    nums.forEach((n) => pool.push({ letter: L, num: n }));
  });
  pool = shuffle(pool);

  const stations = [];
  for (let s = 0; s < numStations; s++) {
    const calls = pool.slice(s * callsPerStation, (s + 1) * callsPerStation);
    stations.push({ station: s + 1, calls });
  }
  return stations;
}

export function encodeStation(stationObj) {
  const callsStr = stationObj.calls
    .map((c) => `${c.letter}${pad2(c.num)}`)
    .join(",");
  return `STA1|${stationObj.station}|${callsStr}`;
}

export function decodeStation(payload) {
  const parts = payload.split("|");
  if (parts[0] !== "STA1") throw new Error("Not a valid station QR");
  const station = parseInt(parts[1], 10);
  const calls = parts[2].split(",").map((c) => ({
    letter: c[0],
    num: parseInt(c.slice(1), 10),
  }));
  return { station, calls };
}

// ---------- encode / decode: finish QR ----------

export function encodeFinish(riderName, cardIds, visitedStationNumbers) {
  const mask = [1, 2, 3, 4, 5, 6]
    .map((s) => (visitedStationNumbers.includes(s) ? "1" : "0"))
    .join("");
  return `FIN1|${riderName}|${cardIds.join(",")}|${mask}`;
}

export function decodeFinish(payload) {
  const parts = payload.split("|");
  if (parts[0] !== "FIN1") throw new Error("Not a valid finish QR");
  const riderName = parts[1];
  const cardIds = parts[2].split(",");
  const mask = parts[3];
  const visitedStations = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === "1") visitedStations.push(i + 1);
  }
  return { riderName, cardIds, visitedStations };
}

// ---------- marking / scoring ----------

export function markCard(card, visitedStations, allStations) {
  const calledSet = new Set();
  allStations
    .filter((s) => visitedStations.includes(s.station))
    .forEach((s) => s.calls.forEach((c) => calledSet.add(c.letter + pad2(c.num))));

  const columns = LETTERS.map((L) => card[L]);
  columns[2] = [...card.N.slice(0, 2), "FREE", ...card.N.slice(2)];

  const grid = [];
  let filledCount = 0;
  for (let row = 0; row < 5; row++) {
    const rowArr = [];
    for (let col = 0; col < 5; col++) {
      const val = columns[col][row];
      let marked;
      if (val === "FREE") {
        marked = true;
      } else {
        marked = calledSet.has(LETTERS[col] + pad2(val));
      }
      if (marked) filledCount++;
      rowArr.push(marked);
    }
    grid.push(rowArr);
  }
  return { grid, filledCount };
}

export function checkPatterns(grid) {
  const corners =
    grid[0][0] && grid[0][4] && grid[4][0] && grid[4][4];

  const anyLine = (() => {
    for (let r = 0; r < 5; r++) if (grid[r].every(Boolean)) return true;
    for (let c = 0; c < 5; c++) if (grid.every((row) => row[c])) return true;
    if ([0, 1, 2, 3, 4].every((i) => grid[i][i])) return true;
    if ([0, 1, 2, 3, 4].every((i) => grid[i][4 - i])) return true;
    return false;
  })();

  const blackout = grid.every((row) => row.every(Boolean));

  const linesCompleted = (() => {
    let count = 0;
    for (let r = 0; r < 5; r++) if (grid[r].every(Boolean)) count++;
    for (let c = 0; c < 5; c++) if (grid.every((row) => row[c])) count++;
    if ([0, 1, 2, 3, 4].every((i) => grid[i][i])) count++;
    if ([0, 1, 2, 3, 4].every((i) => grid[i][4 - i])) count++;
    return count;
  })();

  return {
    blackout,
    fourCornersPlusTwoLines: corners && linesCompleted >= 2,
    fourCorners: corners,
    anyLine,
  };
}

export function determineWinner(entries) {
  const withPatterns = entries.map((e) => ({
    ...e,
    patterns: checkPatterns(e.grid),
  }));

  const tiers = [
    (e) => e.patterns.blackout,
    (e) => e.patterns.fourCornersPlusTwoLines,
    (e) => e.patterns.fourCorners,
    (e) => e.patterns.anyLine,
  ];

  for (const test of tiers) {
    const matches = withPatterns.filter(test);
    if (matches.length > 0) {
      const maxFilled = Math.max(...matches.map((m) => m.filledCount));
      return matches.filter((m) => m.filledCount === maxFilled);
    }
  }

  const maxFilled = Math.max(...withPatterns.map((m) => m.filledCount));
  return withPatterns.filter((m) => m.filledCount === maxFilled);
}
