// Draws a SHA-256 fingerprint as an OMR answer sheet: 64 "questions"
// (one per hex character), 16 options each (0 to f). The file's fingerprint
// is pencilled in; when there is an answer key from the ledger, every row
// that disagrees gets the right bubble circled in red pen.

const HEX = "0123456789abcdef";
const SVG_NS = "http://www.w3.org/2000/svg";
const PITCH_X = 11.5;
const PITCH_Y = 13;
const R = 4.3;
const NUM_W = 20;
const BLOCK_GAP = 22;
const TOP = 20;
const LEFT = 20;

// cols is 4 (one band of four blocks) or 2 (two bands of two, for phones).
function layout(cols) {
  return { blocksAcross: cols, blocksDown: 4 / cols, rowsPerBlock: 16 };
}

export function createSheet(container, { cols = 4, label = "Fingerprint answer sheet" } = {}) {
  let state = { digits: null, key: null, cols };
  let timers = [];
  let rows = [];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "omr");
  svg.setAttribute("role", "img");
  container.replaceChildren(svg);

  function el(name, attrs, parent) {
    const n = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent.appendChild(n);
    return n;
  }

  function build() {
    svg.replaceChildren();
    rows = [];
    const L = layout(state.cols);
    const blockW = NUM_W + 16 * PITCH_X + BLOCK_GAP;
    const blockH = TOP + L.rowsPerBlock * PITCH_Y + 18;
    const width = LEFT + L.blocksAcross * blockW - BLOCK_GAP + 8;
    const height = L.blocksDown * blockH;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Timing marks down the edge, one per printed row, as on a real sheet.
    const marks = el("g", { class: "omr-timing", "aria-hidden": "true" }, svg);
    for (let band = 0; band < L.blocksDown; band++) {
      for (let r = 0; r < L.rowsPerBlock; r++) {
        el("rect", { x: 2, y: band * blockH + TOP + r * PITCH_Y - 2, width: 9, height: 4 }, marks);
      }
    }

    for (let b = 0; b < 4; b++) {
      const bx = LEFT + (b % L.blocksAcross) * blockW;
      const by = Math.floor(b / L.blocksAcross) * blockH;
      const g = el("g", { class: "omr-block", "aria-hidden": "true" }, svg);
      HEX.split("").forEach((h, c) => {
        const t = el("text", { x: bx + NUM_W + c * PITCH_X + PITCH_X / 2, y: by + 9, class: "omr-head" }, g);
        t.textContent = h;
      });
      for (let r = 0; r < L.rowsPerBlock; r++) {
        const index = b * 16 + r;
        const cy = by + TOP + r * PITCH_Y;
        const rowG = el("g", { class: "omr-row" }, g);
        const num = el("text", { x: bx + NUM_W - 5, y: cy + 2.6, class: "omr-num" }, rowG);
        num.textContent = String(index + 1);
        const bubbles = [];
        for (let c = 0; c < 16; c++) {
          const cx = bx + NUM_W + c * PITCH_X + PITCH_X / 2;
          const bubble = el("g", { class: "omr-bubble" }, rowG);
          el("circle", { cx, cy, r: R, class: "omr-ring" }, bubble);
          const letter = el("text", { x: cx, y: cy + 1.9, class: "omr-letter" }, bubble);
          letter.textContent = HEX[c];
          el("circle", { cx, cy, r: R - 0.6, class: "omr-fill" }, bubble);
          el("circle", { cx, cy, r: R + 2.2, class: "omr-key" }, bubble);
          bubbles.push(bubble);
        }
        rows.push({ g: rowG, bubbles });
      }
    }
    paint(false);
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function paintRow(i) {
    const row = rows[i];
    const d = state.digits ? HEX.indexOf(state.digits[i]) : -1;
    const k = state.key ? HEX.indexOf(state.key[i]) : -1;
    const wrong = d >= 0 && k >= 0 && d !== k;
    row.g.classList.toggle("is-wrong", wrong);
    row.bubbles.forEach((bub, c) => {
      bub.classList.toggle("is-filled", c === d);
      bub.classList.toggle("is-key", wrong && c === k);
    });
  }

  function paint(animate) {
    clearTimers();
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) {
      for (let i = 0; i < 64; i++) paintRow(i);
      return Promise.resolve();
    }
    // Pencil the rows in order: it shows a fingerprint is 64 separate marks.
    return new Promise((resolve) => {
      for (let i = 0; i < 64; i++) {
        timers.push(setTimeout(() => {
          paintRow(i);
          if (i === 63) resolve();
        }, i * 7));
      }
    });
  }

  function describe() {
    if (!state.digits) return `${label}: empty`;
    let text = `${label}: ${state.digits}`;
    if (state.key) {
      const wrong = [...state.digits].filter((ch, i) => ch !== state.key[i]).length;
      text += wrong ? `. ${64 - wrong} of 64 characters match the sealed fingerprint.` : ". All 64 characters match the sealed fingerprint.";
    }
    return text;
  }

  build();

  return {
    setFingerprint(hex, { key = null, animate = true } = {}) {
      state.digits = hex;
      state.key = key;
      svg.setAttribute("aria-label", describe());
      return paint(animate);
    },
    clear() {
      state.digits = null;
      state.key = null;
      svg.setAttribute("aria-label", describe());
      return paint(false);
    },
    relayout(cols) {
      if (cols === state.cols) return;
      state.cols = cols;
      build();
      svg.setAttribute("aria-label", describe());
    },
  };
}
