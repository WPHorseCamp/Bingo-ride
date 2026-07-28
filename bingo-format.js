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
 * Issuance QR:       "BINGO1|<riderName>|<card1>|<card2>|<card3>"
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

/**
 * Generate one random, valid bingo card.
 * @param {string} cardId - e.g. "C001"
 */
export function generateCard(cardId) {
  return {
    id: cardId,
    B: pickN(RANGES.B[0], RANGES.B[1], 5),
    I: pickN(RANGES.I[0], RANGES.I[1], 5),
    N: pickN(RANGES.N[0], RANGES.N[1], 4), // center square is FREE, not a number
    G: pickN(RANGES.G[0], RANGES.G[1], 5),
    O: pickN(RANGES.O[0], RANGES.O[1], 5),
  };
}

/**
 * Generate a batch of guaranteed-unique cards.
 * @param {number} count
 * @param {number} startIndex - card numbering starts here (1-based)
 */
export function generateUniqueCards(count, startIndex = 1) {
  const cards = [];
  const seen = new Set();
  let idx = startIndex;
  while (cards.length < count) {
    const card = generateCard("C" + String(idx).padStart(3, "0"));
    const key = encodeCard(card).split(":")[1]; // fingerprint = the number layout
    if (!seen.has(key)) {
      seen.add(key);
      cards.push(card);
      idx++;
    }
    // collisions are astronomically unlikely; loop just re-rolls in place
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
  // ";" separates top-level fields since card strings already use "|" internally
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

/**
 * Build the full set of station call sheets for the ride.
 * Draws a proportional, non-repeating set of calls across all stations
 * so no number is called twice across the whole ride.
 * @param {number} numStations
 * @param {number} callsPerStation
 */
export function generateStations(numStations = 6, callsPerStation = 6) {
  const totalCalls = numStations * callsPerStation; // e.g. 36
  const perLetter = Math.floor(totalCalls / LETTERS.length); // e.g. 7 (36/5)
  const remainder = totalCalls - perLetter * LETTERS.length;

  // Build a pool of calls, roughly even across letters
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

/**
 * Given a card and the set of stations visited, and the master list of
 * all stations' calls, compute which of the 25 squares are marked.
 * This is the function BOTH the rider phone (live UI) and the Director
 * app (authoritative finish-line check) should call — same inputs,
 * same answer, every time.
 *
 * @param {object} card - decoded card
 * @param {number[]} visitedStations - station numbers the rider scanned
 * @param {object[]} allStations - full array from generateStations()
 * @returns {{grid: boolean[][], filledCount: number}} 5x5 grid, row-major,
 *          center [2][2] is always true (FREE)
 */
export function markCard(card, visitedStations, allStations) {
  const calledSet = new Set();
  allStations
    .filter((s) => visitedStations.includes(s.station))
    .forEach((s) => s.calls.forEach((c) => calledSet.add(c.letter + pad2(c.num))));

  // Build the 5x5 display grid: columns B,I,N,G,O; N column has FREE at row 2
  const columns = LETTERS.map((L) => card[L]);
  columns[2] = [...card.N.slice(0, 2), "FREE", ...card.N.slice(2)]; // insert FREE at center

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

// ---------- WIN PATTERNS ----------
// Grid is 5x5, row-major, row=0..4 top-to-bottom, col=0..4 = B,I,N,G,O.
// Each pattern is either:
//   { name, mask }      - a fixed 5x5 boolean mask; grid must be true at every mask cell
//   { name, kind }       - a special multi-option pattern needing custom logic (see matchesPattern)
// The center (2,2) is always FREE/true, so masks never need to special-case it.

function emptyMask() {
  return [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]].map(r=>r.map(()=>false));
}
function maskFromCells(cells) {
  const m = emptyMask();
  cells.forEach(([r,c]) => { m[r][c] = true; });
  return m;
}
function fullRow(r) { return maskFromCells([0,1,2,3,4].map(c=>[r,c])); }
function fullCol(c) { return maskFromCells([0,1,2,3,4].map(r=>[r,c])); }
function combineMasks(...masks) {
  const m = emptyMask();
  masks.forEach(mask => mask.forEach((row,r) => row.forEach((v,c) => { if (v) m[r][c] = true; })));
  return m;
}
function manhattanRing(dist) {
  const cells = [];
  for (let r=0;r<5;r++) for (let c=0;c<5;c++) if (Math.abs(r-2)+Math.abs(c-2) === dist) cells.push([r,c]);
  return maskFromCells(cells);
}
function manhattanFilled(maxDist) {
  const cells = [];
  for (let r=0;r<5;r++) for (let c=0;c<5;c++) if (Math.abs(r-2)+Math.abs(c-2) <= maxDist) cells.push([r,c]);
  return maskFromCells(cells);
}

const FOUR_CORNERS = maskFromCells([[0,0],[0,4],[4,0],[4,4]]);

export const PATTERNS = {
  blackout:          { name: "Blackout / Coverall", mask: manhattanFilled(4) },
  anyLine:           { name: "Any Line (row, column, or diagonal)", kind: "anyLine" },
  bingoAnyWay:       { name: "Bingo Any Way", kind: "anyLine" },
  fourCorners:       { name: "Four Corners", mask: FOUR_CORNERS },
  anyThreeCorners:   { name: "Any Three Corners", kind: "anyThreeCorners" },
  line1:             { name: "Line 1 (top row)", mask: fullRow(0) },
  line2:             { name: "Line 2", mask: fullRow(1) },
  line3:             { name: "Line 3 (middle row)", mask: fullRow(2) },
  line4:             { name: "Line 4", mask: fullRow(3) },
  line5:             { name: "Line 5 (bottom row)", mask: fullRow(4) },
  postageStamp:      { name: "Postage Stamp", mask: maskFromCells([[0,3],[0,4],[1,3],[1,4]]) },
  doublePostageStamp:{ name: "Double Postage Stamp", mask: maskFromCells([[0,0],[0,1],[1,0],[1,1],[0,3],[0,4],[1,3],[1,4]]) },
  windowPane:        { name: "Window Pane (all 4 corners 2x2)", mask: maskFromCells([
                          [0,0],[0,1],[1,0],[1,1], [0,3],[0,4],[1,3],[1,4],
                          [3,0],[3,1],[4,0],[4,1], [3,3],[3,4],[4,3],[4,4]
                        ]) },
  sixPack:           { name: "Six Pack", mask: maskFromCells([[0,1],[0,2],[0,3],[1,1],[1,2],[1,3]]) },
  pictureFrame:      { name: "Picture Frame", mask: combineMasks(fullRow(0), fullRow(4), fullCol(0), fullCol(4)) },
  smallDiamond:      { name: "Small Diamond", mask: manhattanRing(2) },
  fullDiamond:       { name: "Full Diamond", mask: manhattanFilled(2) },
  plusCross:         { name: "Plus / Cross", mask: combineMasks(fullRow(2), fullCol(2)) },
  xPattern:          { name: "X Pattern (both diagonals)", mask: maskFromCells([[0,0],[1,1],[2,2],[3,3],[4,4],[0,4],[1,3],[3,1],[4,0]]) },
  railroadTracks:    { name: "Railroad Tracks (B & O columns)", mask: combineMasks(fullCol(0), fullCol(4)) },
  letterT:           { name: 'Letter "T"', mask: combineMasks(fullRow(0), fullCol(2)) },
  letterL:           { name: 'Letter "L"', mask: combineMasks(fullCol(0), fullRow(4)) },
  letterI:           { name: 'Letter "I"', mask: combineMasks(fullRow(0), fullCol(2), fullRow(4)) },
  letterH:           { name: 'Letter "H"', mask: combineMasks(fullCol(0), fullCol(4), fullRow(2)) },
  letterU:           { name: 'Letter "U"', mask: combineMasks(fullCol(0), fullCol(4), fullRow(4)) },
  letterC:           { name: 'Letter "C"', mask: combineMasks(fullCol(0), fullRow(0), fullRow(4)) },
  letterE:           { name: 'Letter "E"', mask: combineMasks(fullCol(0), fullRow(0), fullRow(2), fullRow(4)) },
  letterF:           { name: 'Letter "F"', mask: combineMasks(fullCol(0), fullRow(0), fullRow(2)) },
  numeral1:          { name: "#1", mask: fullCol(2) },
  checkerboard:      { name: "Checkerboard", mask: maskFromCells((()=>{const c=[];for(let r=0;r<5;r++)for(let col=0;col<5;col++)if((r+col)%2===0)c.push([r,col]);return c;})()) },
};

/** Does this grid satisfy the given pattern key? */
export function matchesPattern(grid, patternKey) {
  const def = PATTERNS[patternKey];
  if (!def) return false;

  if (def.kind === "anyLine") {
    for (let r=0;r<5;r++) if (grid[r].every(Boolean)) return true;
    for (let c=0;c<5;c++) if (grid.every(row=>row[c])) return true;
    if ([0,1,2,3,4].every(i=>grid[i][i])) return true;
    if ([0,1,2,3,4].every(i=>grid[i][4-i])) return true;
    return false;
  }
  if (def.kind === "anyThreeCorners") {
    const corners = [grid[0][0], grid[0][4], grid[4][0], grid[4][4]];
    return corners.filter(Boolean).length >= 3;
  }
  // fixed mask
  for (let r=0;r<5;r++) for (let c=0;c<5;c++) if (def.mask[r][c] && !grid[r][c]) return false;
  return true;
}

/** Every pattern key this grid currently satisfies (for display, e.g. "Sarah's card is a Four Corners"). */
export function matchedPatterns(grid) {
  return Object.keys(PATTERNS).filter(key => matchesPattern(grid, key));
}

/**
 * Rank a list of {riderName, cardId, grid, filledCount} entries using the
 * Director's chosen, ordered list of pattern keys (from PATTERNS). The first
 * pattern in the list that at least one entry satisfies wins that round; ties
 * within a pattern are broken by most-filled, then returned together as an
 * exact tie for the Director to resolve manually. If nothing in the priority
 * list is satisfied by anyone, the guaranteed fallback is most-squares-filled.
 *
 * @param {object[]} entries
 * @param {string[]} priorityKeys - ordered list of PATTERNS keys, Director-defined
 */
export function determineWinner(entries, priorityKeys) {
  const keys = (priorityKeys && priorityKeys.length) ? priorityKeys : [];

  for (const key of keys) {
    const matches = entries.filter(e => matchesPattern(e.grid, key));
    if (matches.length > 0) {
      const maxFilled = Math.max(...matches.map(m => m.filledCount));
      const winners = matches.filter(m => m.filledCount === maxFilled);
      return { winners, patternKey: key, patternName: PATTERNS[key] ? PATTERNS[key].name : key };
    }
  }

  // Guaranteed fallback: most squares filled, ties returned together
  const maxFilled = Math.max(...entries.map(m => m.filledCount));
  const winners = entries.filter(m => m.filledCount === maxFilled);
  return { winners, patternKey: null, patternName: "Most squares filled" };
}
