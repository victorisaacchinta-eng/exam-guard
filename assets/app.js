import {
  checkFile, toHex, validateRegistry, assessSeal, decideVerdict, checkExamName, buildMetadata,
  SEAL_STATUS_TEXT, shortHash, formatBytes, formatBlockTime, explorerTxUrl, utf8Length, METADATA_TEXT_MAX,
} from "./core.js";
import { fetchSeals, LedgerError } from "./ledger.js";
import { createSheet } from "./omr.js";

const $ = (sel) => document.querySelector(sel);

// Small DOM builder. Text always goes in through textContent, so names read
// from the ledger can never inject markup.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const state = {
  registry: null,
  network: "preprod",
  assessments: new Map(),
  ledgerError: null,
  ledgerPromise: null,
  tip: null,
  current: null, // { name, size, fingerprint }
  run: 0,
};

const narrow = matchMedia("(max-width: 640px)");
const sheet = createSheet($("#sheet"), { cols: narrow.matches ? 2 : 4 });
narrow.addEventListener("change", (e) => sheet.relayout(e.matches ? 2 : 4));

// ---------- registry and ledger ----------

async function loadRegistry() {
  const res = await fetch("registry.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`registry.json answered ${res.status}`);
  const reg = validateRegistry(await res.json());
  if (reg.errors.length) console.warn("registry problems:", reg.errors);
  return reg;
}

function readLedger() {
  const seals = state.registry ? state.registry.seals : [];
  state.ledgerPromise = fetchSeals(seals.map((s) => s.tx))
    .then(({ seals: chain, tip }) => {
      state.ledgerError = null;
      state.tip = tip;
      state.assessments = new Map(seals.map((s) => [s.id, assessSeal(s, chain.get(s.tx))]));
    })
    .catch((err) => {
      state.ledgerError = err instanceof LedgerError ? err : new LedgerError(String(err && err.message), "upstream");
      state.assessments = new Map(seals.map((s) => [s.id, { status: "unreachable", detail: state.ledgerError.message }]));
    })
    .finally(renderRegister);
  return state.ledgerPromise;
}

function statusClass(status) {
  if (status === "verified") return "is-ok";
  if (status === "unreachable") return "is-wait";
  return "is-bad";
}

function renderRegister() {
  const body = $("#register-body");
  const seals = state.registry ? state.registry.seals : [];
  if (seals.length === 0) {
    body.replaceChildren(h("tr", {}, h("td", { colspan: 5, class: "register-empty", text: "No papers have been sealed yet." })));
    return;
  }
  body.replaceChildren(...seals.map((s) => {
    const a = state.assessments.get(s.id) || { status: "unreachable" };
    const meta = a.chain && a.chain.metadata;
    const fp = meta ? meta.fingerprint : s.fingerprint;
    return h("tr", {},
      h("td", { "data-label": "Paper" },
        h("div", { class: "paper-name", text: meta && meta.exam ? meta.exam : s.exam }),
        s.note ? h("p", { class: "paper-note", text: s.note }) : null),
      h("td", { "data-label": a.chain ? "Fingerprint on the ledger" : "Fingerprint in the registry (not yet read from the ledger)" },
        h("code", { text: fp })),
      h("td", { "data-label": "Sealed" },
        a.chain && a.chain.blockTime ? h("div", { text: formatBlockTime(a.chain.blockTime) }) : h("div", { text: "Unknown" }),
        a.chain && a.chain.blockHeight ? h("div", { class: "paper-note", text: `Block ${a.chain.blockHeight.toLocaleString("en-US")}` }) : null,
        h("a", { href: explorerTxUrl(state.network, s.tx), target: "_blank", rel: "noopener", text: "Open on Cardanoscan" })),
      h("td", { "data-label": "Signed by" },
        h("div", { text: s.issuerName }),
        h("code", { class: "paper-note", title: s.issuerAddress, text: shortHash(s.issuerAddress, 12, 6) })),
      h("td", { "data-label": "Status" },
        h("span", { class: `status ${statusClass(a.status)}`, text: SEAL_STATUS_TEXT[a.status] || a.status })),
    );
  }));

  const tipEl = $("#ledger-tip");
  if (state.ledgerError) {
    tipEl.replaceChildren(
      `${state.ledgerError.message} `,
      h("button", { type: "button", class: "copy", onclick: () => { tipEl.textContent = "Trying again…"; readLedger(); }, text: "Try again" }),
    );
  } else if (state.tip) {
    tipEl.textContent = `Read live from Cardano ${state.network}. Latest block ${state.tip.blockHeight.toLocaleString("en-US")}.`;
  }
}

function populateClaims() {
  const select = $("#claim");
  for (const s of state.registry.seals) select.append(h("option", { value: s.id, text: s.exam }));
}

// ---------- verifying a file ----------

async function fingerprintOf(file) {
  if (!globalThis.crypto || !crypto.subtle) throw new Error("This browser cannot compute SHA-256 here. Open the page over https.");
  return toHex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
}

function showFileName(el, file) {
  el.hidden = false;
  el.textContent = `${file.name || "Unnamed file"} (${formatBytes(file.size)})`;
}

function busy(message) {
  $("#result").replaceChildren(h("div", { class: "result-busy", role: "status" }, h("span", { class: "bar", "aria-hidden": "true" }), h("span", { text: message })));
}

function plainError(message) {
  $("#result").replaceChildren(h("div", { class: "verdict" },
    h("div", { class: "label is-problem" }, h("div", { class: "label-main" },
      h("h2", { text: "Can't check that file" }), h("p", { class: "label-text", text: message })))));
}

async function handleFile(file, { fromSample = false } = {}) {
  const run = ++state.run;
  const problem = checkFile(file);
  showFileName($("#drop-file"), file || { name: "", size: 0 });
  if (problem) {
    state.current = null;
    sheet.clear();
    $("#sheet-hex").textContent = " ";
    $("#sheet-sub").textContent = "64 characters, one bubble each. Waiting for a file.";
    plainError(problem);
    return;
  }
  busy("Fingerprinting the file in your browser…");
  let fingerprint;
  try {
    fingerprint = await fingerprintOf(file);
  } catch (err) {
    if (run === state.run) plainError(err.message);
    return;
  }
  if (run !== state.run) return; // a newer file arrived while this one hashed
  state.current = { name: file.name, size: file.size, fingerprint, fromSample };
  $("#sheet-hex").textContent = fingerprint;
  $("#sheet-sub").replaceChildren("Pencilled from ", h("strong", { text: file.name || "your file" }), ".");
  const drawn = sheet.setFingerprint(fingerprint, { animate: true });
  busy("Reading the seal from the Cardano ledger…");
  await Promise.all([drawn, ready]);
  await state.ledgerPromise;
  if (run !== state.run) return;
  renderVerdict();
}

function receiptRow(label, value, { copy } = {}) {
  return h("div", {}, h("dt", { text: label }), h("dd", {}, value, copy ? copyButton(copy) : null));
}

function copyButton(text, { label = "Copy", className = "copy" } = {}) {
  const btn = h("button", { type: "button", class: className, text: label });
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Copy blocked, select the text";
    }
    btn.classList.add("is-done");
    setTimeout(() => { btn.textContent = label; btn.classList.remove("is-done"); }, 1400);
  });
  return btn;
}

function serial(seal) {
  return h("div", { class: "label-serial", "aria-hidden": "true" },
    h("b", { text: "Security seal" }), h("span", { text: seal ? seal.tx.slice(0, 12).toUpperCase() : "NO RECORD" }));
}

function labelLines(rows) {
  return h("dl", { class: "label-lines" }, rows.map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v }))));
}

function retryButton() {
  return h("button", { type: "button", class: "btn", onclick: async (e) => {
    e.currentTarget.setAttribute("aria-busy", "true");
    busy("Reading the seal from the Cardano ledger…");
    await readLedger();
    renderVerdict();
  }, text: "Try the ledger again" });
}

function renderVerdict() {
  const cur = state.current;
  if (!cur) return;
  const claimedId = $("#claim").value || null;
  const seals = state.registry ? state.registry.seals : [];
  const v = decideVerdict({ fingerprint: cur.fingerprint, claimedId, seals, assessments: state.assessments });
  const chain = v.assessment && v.assessment.chain;
  const onChain = chain && chain.metadata ? chain.metadata.fingerprint : null;

  // Put the answer key on the sheet when there is one to compare with.
  sheet.setFingerprint(cur.fingerprint, { key: v.kind === "broken" || v.kind === "intact" ? onChain : null, animate: false });
  if (v.kind === "broken") {
    $("#sheet-sub").replaceChildren(h("strong", { text: `${v.diff.matched} of 64` }), " characters match the sealed fingerprint. Red circles mark the sealed answer.");
  } else if (v.kind === "intact") {
    $("#sheet-sub").replaceChildren(h("strong", { text: "64 of 64" }), " characters match the sealed fingerprint.");
  }

  let label;
  const when = chain && chain.blockTime ? formatBlockTime(chain.blockTime) : "Unknown";
  if (v.kind === "intact") {
    label = h("div", { class: "label is-intact" },
      h("div", { class: "label-main" },
        h("h2", { text: "Seal intact" }),
        h("p", { class: "label-text", text: `This file is byte for byte the paper sealed as "${chain.metadata.exam || v.seal.exam}".` }),
        labelLines([["Sealed", when], ["Block", chain.blockHeight ? chain.blockHeight.toLocaleString("en-US") : "Unknown"],
          ["Signed by", v.seal.issuerName], ["Confirmations", chain.confirmations != null ? chain.confirmations.toLocaleString("en-US") : "Unknown"]])),
      serial(v.seal));
  } else if (v.kind === "broken") {
    label = h("div", { class: "label is-broken" },
      h("div", { class: "void", "aria-hidden": "true" }),
      h("div", { class: "label-main" },
        h("h2", { text: "Seal broken" }),
        h("p", { class: "label-text", text: `This file is not the paper sealed as "${chain.metadata.exam || v.seal.exam}". Even a one-character edit changes the fingerprint, so treat this copy as altered or as a different file.` }),
        labelLines([["Sealed paper", v.seal.exam], ["Sealed", when], ["Characters matching", `${v.diff.matched} of 64`], ["Signed by", v.seal.issuerName]])),
      serial(v.seal));
  } else if (v.kind === "no-seal") {
    label = h("div", { class: "label is-none" },
      h("div", { class: "label-main" },
        h("h2", { text: "No seal on file" }),
        h("p", { class: "label-text", text: "No sealed paper in the registry has this fingerprint. Either it was never sealed, or it differs from the sealed version. Pick the paper it should be under \"Compare with\" to see how it differs." }),
        cur.fromSample && !seals.some((s) => s.id === state.registry.demo?.seal)
          ? h("p", { class: "label-text", text: "The mock paper has not been written to the ledger yet, so this is the expected answer until it is." }) : null),
      serial(null));
  } else if (v.kind === "unverifiable") {
    label = h("div", { class: "label is-unknown" },
      h("div", { class: "label-main" },
        h("h2", { text: "Ledger unreachable" }),
        h("p", { class: "label-text", text: `${state.ledgerError ? state.ledgerError.message : "The ledger did not answer."} The fingerprint is ready; nothing is decided until the seal is read.` }),
        retryButton()),
      serial(v.seal));
  } else {
    const status = v.assessment ? v.assessment.status : "unknown";
    label = h("div", { class: "label is-problem" },
      h("div", { class: "label-main" },
        h("h2", { text: "Record problem" }),
        h("p", { class: "label-text", text: `${SEAL_STATUS_TEXT[status] || "The seal could not be confirmed"}. Exam Guard will not vouch for this paper until the registry and the ledger agree.` })),
      serial(v.seal || null));
  }

  const rows = [
    receiptRow("File", h("span", { text: cur.name || "Unnamed file" })),
    receiptRow("Size", h("span", { text: `${formatBytes(cur.size)} (${cur.size.toLocaleString("en-US")} bytes)` })),
    receiptRow("Your file's fingerprint", h("code", { text: cur.fingerprint }), { copy: cur.fingerprint }),
  ];
  if (onChain) rows.push(receiptRow("Fingerprint on the ledger", h("code", { text: onChain }), { copy: onChain }));
  if (v.seal) {
    rows.push(receiptRow("Transaction", h("a", { href: explorerTxUrl(state.network, v.seal.tx), target: "_blank", rel: "noopener" }, h("code", { text: shortHash(v.seal.tx, 12, 12) })), { copy: v.seal.tx }));
    rows.push(receiptRow("Signing wallet", h("code", { text: shortHash(v.seal.issuerAddress, 14, 8), title: v.seal.issuerAddress }), { copy: v.seal.issuerAddress }));
  }
  const receipt = h("div", {},
    h("h3", { class: "receipt-title", text: "Receipt" }),
    h("dl", { class: "receipt" }, rows),
    v.kind === "broken" ? h("p", { class: "diff-note" }, h("strong", { text: `${64 - v.diff.matched} of 64` }), " characters differ. SHA-256 is built so that any change scatters across the whole fingerprint.") : null,
  );

  $("#result").replaceChildren(h("div", { class: "verdict" }, label, receipt));
  // On a phone the verdict lands below the fold; bring it up once.
  const top = $("#result").getBoundingClientRect().top;
  if (top > window.innerHeight * 0.8) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("#result").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
}

// ---------- intake: drop zone, picker, samples ----------

function wireDrop(zone, input, onFile) {
  const over = (on) => zone.classList.toggle("is-over", on);
  zone.addEventListener("dragenter", (e) => { e.preventDefault(); over(true); });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; over(true); });
  zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) over(false); });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    over(false);
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFile(files[0], files.length);
  });
  input.addEventListener("change", () => {
    if (input.files && input.files.length) onFile(input.files[0], input.files.length);
    input.value = ""; // so choosing the same file again still fires
  });
}

// A file dropped outside a drop zone would otherwise replace the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length && !e.target.closest(".drop")) handleFile(files[0]);
});

wireDrop($("#drop"), $("#file"), async (file, count) => {
  await handleFile(file);
  if (count > 1) $("#drop-file").textContent += `. You dropped ${count} files; only this one was checked.`;
});

$("#claim").addEventListener("change", () => { if (state.current) renderVerdict(); });

document.querySelectorAll("[data-sample]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const demo = state.registry && state.registry.demo;
    if (!demo) return;
    const which = btn.dataset.sample;
    const path = which === "tampered" ? demo.tampered : demo.original;
    btn.setAttribute("aria-busy", "true");
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Could not load the sample (${res.status}).`);
      const blob = await res.blob();
      const file = new File([blob], path.split("/").pop(), { type: "application/pdf" });
      const sealed = state.registry.seals.some((s) => s.id === demo.seal);
      $("#claim").value = which === "tampered" && sealed ? demo.seal : "";
      await handleFile(file, { fromSample: true });
    } catch (err) {
      plainError(err instanceof TypeError ? "Could not download the sample. Check your connection and try again." : err.message);
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
});

// ---------- seal a paper ----------

const sealState = { file: null, fingerprint: null, run: 0 };

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSealOut() {
  const out = $("#seal-out");
  const nameInput = $("#seal-name");
  const help = $("#seal-name-help");
  const typed = nameInput.value;
  const check = checkExamName(typed);
  const bytes = utf8Length(typed.trim());
  if (typed.trim()) {
    help.textContent = check.ok ? `${bytes} of ${METADATA_TEXT_MAX} bytes.` : check.error;
    help.classList.toggle("is-error", !check.ok);
    nameInput.setAttribute("aria-invalid", check.ok ? "false" : "true");
  } else {
    help.textContent = `Up to ${METADATA_TEXT_MAX} bytes, the limit for a text field in Cardano metadata.`;
    help.classList.remove("is-error");
    nameInput.removeAttribute("aria-invalid");
  }
  if (!sealState.fingerprint || !check.ok) {
    out.replaceChildren(h("p", { class: "seal-empty", text: sealState.fingerprint
      ? "Now name the paper. The name is written to the ledger next to the fingerprint."
      : "The record and the command to publish it appear here once you choose a file and name it." }));
    return;
  }
  const metadata = buildMetadata(check.name, sealState.fingerprint);
  const record = { exam_name: check.name, fingerprint: sealState.fingerprint, file: sealState.file.name, size: sealState.file.size };
  const cmd = `node push_to_chain.js --file ${shellQuote(sealState.file.name)} --exam ${shellQuote(check.name)}`;
  const already = state.registry && state.registry.seals.find((s) => s.fingerprint === sealState.fingerprint);
  out.replaceChildren(...[
    already ? h("p", { class: "field-help is-error", text: `This exact file is already sealed as "${already.exam}". Sealing it again adds a second record for the same file.` }) : null,
    h("div", { class: "seal-block" },
      h("h3", { text: "Fingerprint" }),
      h("p", {}, h("code", { text: sealState.fingerprint })),
    ),
    h("div", { class: "seal-block" },
      h("h3", { text: "Ledger record" }),
      h("p", { text: "Metadata label 674, the same shape as every Exam Guard seal." }),
      h("pre", { class: "code", text: JSON.stringify(metadata, null, 2) }),
    ),
    h("div", { class: "seal-block" },
      h("h3", { text: "Publish it" }),
      h("p", { text: "Run this in the repository folder with the paper beside it (or change the path), and the board's wallet in .env as the README describes. It signs on your machine and adds the seal to registry.json." }),
      h("pre", { class: "code", text: cmd }),
    ),
    h("div", { class: "seal-actions" },
      copyButton(cmd, { label: "Copy command", className: "btn" }),
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => downloadJson("record.json", record), text: "Download record.json" }),
    ),
  ].filter(Boolean));
}

wireDrop($("#seal-file").closest(".drop"), $("#seal-file"), async (file) => {
  const run = ++sealState.run;
  const problem = checkFile(file);
  showFileName($("#seal-file-name"), file);
  sealState.file = null;
  sealState.fingerprint = null;
  if (problem) {
    $("#seal-out").replaceChildren(h("p", { class: "field-help is-error", text: problem }));
    return;
  }
  $("#seal-out").replaceChildren(h("p", { class: "seal-empty", text: "Fingerprinting…" }));
  try {
    const fp = await fingerprintOf(file);
    if (run !== sealState.run) return;
    sealState.file = file;
    sealState.fingerprint = fp;
  } catch (err) {
    $("#seal-out").replaceChildren(h("p", { class: "field-help is-error", text: err.message }));
    return;
  }
  renderSealOut();
});
$("#seal-name").addEventListener("input", renderSealOut);
$("#seal-form").addEventListener("submit", (e) => e.preventDefault());

// ---------- start ----------

const ready = (async function start() {
  try {
    state.registry = await loadRegistry();
    state.network = state.registry.network;
  } catch (err) {
    state.registry = { seals: [], demo: null, network: "preprod", errors: [String(err.message)] };
    $("#register-body").replaceChildren(h("tr", {}, h("td", { colspan: 5, class: "register-empty", text: `Could not load the registry: ${err.message}` })));
  }
  populateClaims();
  const demo = state.registry.demo;
  if (!demo) $("#samples").hidden = true;
  else if (!state.registry.seals.some((s) => s.id === demo.seal)) {
    $("#samples-note").textContent = "The mock paper is not on the ledger yet, so both samples will show as having no seal.";
  }
  await readLedger();
})();
