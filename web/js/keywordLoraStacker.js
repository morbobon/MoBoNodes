// Keyword LoRA Stacker (High/Low) frontend extension.
//
// Canvas-drawn custom widgets in the rgthree Power Lora Loader style (drawing
// approach / hit-region geometry adapted from rgthree-comfy, MIT, Copyright (c)
// Regis Gaughan, III) -- self-contained plain JS, no rgthree dependency.
//
// Each LoRA entry is ONE custom widget drawn as three lines:
//     [toggle]  keyword……………………………
//     H  ◢ high-lora-name                   ◀ 1.00 ▶
//     L  ◢ low-lora-name                    ◀ 1.00 ▶
// - LoRA name slots open a filterable chooser (type to search).
// - Strength supports click-drag scrub, ◀/▶ steppers, and click-to-type.
// - Right-click a row for the context menu (enable / move / remove).
// - Picking one of high/low auto-fills the other by name (high<->low), if empty.
//
// The widget itself is the backend carrier: its name is lora_1, lora_2, ... and
// serializeValue() returns the row object, which the Python node accepts via a
// FlexibleOptionalInputType. Rows are also persisted name-based in
// node.properties.moboLoraRows so they survive save/load robustly.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/* ------------------------------------------------------------------ */
/* LoRA list                                                          */
/* ------------------------------------------------------------------ */
let LORA_LIST = null;            // includes "None" at [0]
let LORA_LIST_PROMISE = null;

async function getLoraList() {
    if (LORA_LIST) return LORA_LIST;
    if (LORA_LIST_PROMISE) return LORA_LIST_PROMISE;
    LORA_LIST_PROMISE = (async () => {
        let names = [];
        try {
            const resp = await api.fetchApi("/object_info/LoraLoader");
            const data = await resp.json();
            names = data?.LoraLoader?.input?.required?.lora_name?.[0] || [];
        } catch (e) {
            console.warn("[MoBo KeywordLoraStacker] could not fetch LoRA list", e);
        }
        LORA_LIST = ["None", ...names];
        return LORA_LIST;
    })();
    return LORA_LIST_PROMISE;
}

/* ------------------------------------------------------------------ */
/* Canvas helpers                                                     */
/* ------------------------------------------------------------------ */
const ROW_H = 20;
const PAD_TOP = 4;
const PAD_BOT = 6;
const GAP = 2;
const MARGIN = 10;

function col(name, fallback) { return LiteGraph[name] || fallback; }
function isLowQuality() { return ((app.canvas?.ds?.scale) ?? 1) <= 0.5; }
function inside(pos, r) {
    return r && pos[0] >= r[0] && pos[0] <= r[0] + r[2] && pos[1] >= r[1] && pos[1] <= r[1] + r[3];
}
function fitString(ctx, str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    const ell = "…";
    let lo = 0, hi = str.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(str.slice(0, mid) + ell).width <= maxW) lo = mid; else hi = mid - 1;
    }
    return str.slice(0, lo) + ell;
}
function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function shortName(name) { return (name || "None").replace(/\.safetensors$/i, ""); }

/* ------------------------------------------------------------------ */
/* High <-> Low name auto-matching                                    */
/* ------------------------------------------------------------------ */
const HL_PAIRS = [
    ["high_noise", "low_noise"],
    ["high-noise", "low-noise"],
    ["high noise", "low noise"],
    ["highnoise", "lownoise"],
    ["high", "low"],
    ["_hn_", "_ln_"],
    ["_h_", "_l_"],
];
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function caseLike(repl, sample) {
    if (sample === sample.toUpperCase()) return repl.toUpperCase();
    if (sample[0] === sample[0].toUpperCase()) return repl.charAt(0).toUpperCase() + repl.slice(1);
    return repl;
}
function detectPolarity(nameRaw) {
    const name = (nameRaw || "").toLowerCase();
    for (const [hi, lo] of HL_PAIRS) {
        if (name.includes(hi)) return { pol: "high" };
        if (name.includes(lo)) return { pol: "low" };
    }
    return null;
}
function flipAll(nameRaw, pol) {
    let out = nameRaw;
    for (const [hi, lo] of HL_PAIRS) {
        const from = pol === "high" ? hi : lo;
        const to = pol === "high" ? lo : hi;
        out = out.replace(new RegExp(escapeReg(from), "ig"), (m) => caseLike(to, m));
    }
    return out;
}
function normForMatch(nameRaw) {
    let s = (nameRaw || "").toLowerCase().replace(/\.safetensors$/i, "");
    for (const [hi, lo] of HL_PAIRS) { s = s.split(hi).join(" ").split(lo).join(" "); }
    return s.replace(/[0-9]+/g, " ").replace(/[^a-z]+/g, "");
}
function levRatio(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    let cur = new Array(n + 1);
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, cur] = [cur, prev];
    }
    return 1 - prev[n] / Math.max(a.length, n);
}
function findCounterpart(nameRaw, list) {
    if (!nameRaw || nameRaw === "None" || !list) return null;
    const det = detectPolarity(nameRaw);
    if (!det) return null;
    const oppPol = det.pol === "high" ? "low" : "high";

    // Stage 1: exact flip (respects versions; accepted only if it exists).
    const flipped = flipAll(nameRaw, det.pol).toLowerCase();
    for (const c of list) if (c !== "None" && c.toLowerCase() === flipped) return c;

    // Stage 2: fuzzy fallback (differing epoch/id numbers); bail if ambiguous.
    const src = normForMatch(nameRaw);
    let best = null, bestScore = 0, second = 0;
    for (const c of list) {
        if (c === "None") continue;
        const cd = detectPolarity(c);
        if (!cd || cd.pol !== oppPol) continue;
        const s = levRatio(src, normForMatch(c));
        if (s > bestScore) { second = bestScore; bestScore = s; best = c; }
        else if (s > second) { second = s; }
    }
    if (best && bestScore >= 0.86 && (bestScore - second) >= 0.06) return best;
    return null;
}

/* ------------------------------------------------------------------ */
/* Filterable LoRA chooser (transient DOM overlay)                    */
/* ------------------------------------------------------------------ */
let _activeChooser = null;
function closeChooser() {
    if (_activeChooser) { _activeChooser.remove(); _activeChooser = null; }
    document.removeEventListener("pointerdown", onDocDown, true);
}
function onDocDown(e) { if (_activeChooser && !_activeChooser.contains(e.target)) closeChooser(); }
function showLoraChooser(event, current, onChoose) {
    closeChooser();
    const list = LORA_LIST || ["None"];
    const menu = document.createElement("div");
    _activeChooser = menu;
    // Theme-aware: use ComfyUI CSS variables with dark fallbacks.
    menu.style.cssText = `position:fixed; z-index:10000; min-width:320px; max-width:520px;
        background:var(--comfy-menu-bg,#1c1c2b); border:1px solid var(--border-color,#555); border-radius:6px;
        box-shadow:0 6px 24px rgba(0,0,0,.5); padding:4px;
        font-family:sans-serif; font-size:12px; color:var(--fg-color,#ddd);`;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type to filter…";
    input.style.cssText = `width:100%; box-sizing:border-box; height:24px; margin-bottom:4px;
        background:var(--comfy-input-bg,#0f0f1e); color:var(--input-text,#fff);
        border:1px solid var(--border-color,#666); border-radius:4px; padding:0 6px;`;
    menu.appendChild(input);

    const listEl = document.createElement("div");
    listEl.style.cssText = "max-height:320px; overflow-y:auto;";
    menu.appendChild(listEl);

    let items = [];
    let activeIdx = -1;
    function choose(name) { closeChooser(); onChoose(name); }
    function setActive(i) {
        if (!items.length) return;
        activeIdx = (i + items.length) % items.length;
        items.forEach((it, idx) => {
            it.el.style.background = idx === activeIdx ? "#3a8ee6" : "";
            it.el.style.color = idx === activeIdx ? "#fff" : "";
        });
        items[activeIdx].el.scrollIntoView({ block: "nearest" });
    }
    function build(filter) {
        const f = filter.toLowerCase();
        listEl.innerHTML = "";
        items = [];
        let curIdx = 0;
        for (const name of ["None", ...list.filter((n) => n !== "None")]) {
            if (f && !name.toLowerCase().includes(f)) continue;
            const el = document.createElement("div");
            el.textContent = name === "None" ? "(None)" : shortName(name);
            el.title = name;
            el.style.cssText = "padding:3px 6px; cursor:pointer; white-space:nowrap; border-radius:3px;" +
                (name === current ? "outline:1px solid #3a8ee6;" : "");
            const idx = items.length;
            if (name === current) curIdx = idx;
            el.addEventListener("mouseenter", () => setActive(idx));
            el.addEventListener("click", () => choose(name));
            listEl.appendChild(el);
            items.push({ name, el });
        }
        // Open with the current selection highlighted and scrolled into view.
        setActive(curIdx);
    }
    input.addEventListener("input", () => build(input.value));
    input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { setActive(activeIdx + 1); e.preventDefault(); }
        else if (e.key === "ArrowUp") { setActive(activeIdx - 1); e.preventDefault(); }
        else if (e.key === "Enter") { if (items[activeIdx]) choose(items[activeIdx].name); e.preventDefault(); }
        else if (e.key === "Escape") { closeChooser(); e.preventDefault(); }
    });

    document.body.appendChild(menu);
    const x = (event?.clientX ?? 200), y = (event?.clientY ?? 200);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
    build("");
    setTimeout(() => { input.focus(); document.addEventListener("pointerdown", onDocDown, true); }, 0);
}

/* ------------------------------------------------------------------ */
/* Per-LoRA custom widget                                             */
/* ------------------------------------------------------------------ */
const WTYPE = "MOBO_LORA";
function defaultRow() {
    return { on: true, keyword: "", lora_high: "None", lora_low: "None", strengthHigh: 1.0, strengthLow: 1.0 };
}

class LoraEntryWidget {
    constructor(value) {
        this.name = "lora_?";
        this.type = WTYPE;
        this.value = { ...defaultRow(), ...(value || {}) };
        this.options = { serialize: true };
        this.hit = {};
        this._drag = null;
        this._y0 = 0; this._y1 = 0;
    }

    computeSize(width) { return [width, PAD_TOP + 3 * ROW_H + 2 * GAP + PAD_BOT]; }

    serializeValue() {
        const v = this.value;
        return {
            on: !!v.on, keyword: v.keyword || "",
            lora_high: v.lora_high || "None", lora_low: v.lora_low || "None",
            strengthHigh: Number(v.strengthHigh) || 0, strengthLow: Number(v.strengthLow) || 0,
        };
    }

    draw(ctx, node, w, y, _Hpassed) {
        // LiteGraph passes a fixed single-row height here even though layout
        // advances by our computeSize, so compute our real height ourselves —
        // otherwise the card only covers the first row and the H/L lines render
        // on the bare node background.
        const H = PAD_TOP + 3 * ROW_H + 2 * GAP + PAD_BOT;
        this._y0 = y; this._y1 = y + H;
        const v = this.value;
        const TEXT = col("WIDGET_TEXT_COLOR", "#e0e0e0");
        const SEC = col("WIDGET_SECONDARY_TEXT_COLOR", "#999");
        const lowQ = isLowQuality();

        roundRectPath(ctx, MARGIN - 4, y + 1, w - 2 * (MARGIN - 4), H - 2, lowQ ? 0 : 6);
        ctx.fillStyle = col("WIDGET_BGCOLOR", "#222");
        ctx.fill();
        // Darken to rgthree's deep row backing (semi-transparent so it adapts to theme).
        ctx.fillStyle = "rgba(0,0,0,0.32)";
        ctx.fill();
        if (!lowQ) { ctx.strokeStyle = col("WIDGET_OUTLINE_COLOR", "#333"); ctx.lineWidth = 1; ctx.stroke(); }

        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.font = `${col("NODE_TEXT_SIZE", 14)}px Arial`;
        ctx.globalAlpha = v.on ? 1 : 0.45;

        const left = MARGIN + 2;
        const right = w - MARGIN - 2;

        // Row 0: toggle + keyword
        let ry = y + PAD_TOP;
        const tglW = this.drawToggle(ctx, left, ry, ROW_H, v.on);
        this.hit.toggle = [left, ry, tglW, ROW_H];
        const kwx = left + tglW + 8;
        ctx.fillStyle = v.keyword ? TEXT : SEC;
        ctx.fillText(fitString(ctx, v.keyword || "keyword…  (blank = always)", right - kwx), kwx, ry + ROW_H / 2);
        this.hit.keyword = [kwx, ry, right - kwx, ROW_H];

        // Row 1/2: high/low
        ry += ROW_H + GAP;
        this.drawLoraLine(ctx, "H", "high", v.lora_high, v.strengthHigh, v._autoHigh, left, right, ry, TEXT, SEC);
        ry += ROW_H + GAP;
        this.drawLoraLine(ctx, "L", "low", v.lora_low, v.strengthLow, v._autoLow, left, right, ry, TEXT, SEC);

        ctx.globalAlpha = 1;
    }

    drawToggle(ctx, x, y, h, on) {
        // Faithful to rgthree's drawTogglePart: a translucent-white track (so it
        // adapts to any theme) with a muted knob (#89B on / #888 off), knob at
        // +height when on / +0.5·height when off.
        const th = Math.round(h * 0.72);   // toggle height, leaving row margin
        const bgW = th * 1.5;
        const r = th * 0.36;
        const cy = y + h / 2;
        roundRectPath(ctx, x, cy - th / 2, bgW, th, th / 2);
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(on ? x + th : x + th * 0.5, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = on ? "#89B" : "#888";
        ctx.fill();
        return bgW;
    }

    drawStrength(ctx, rightX, y, h, val, decKey, valKey, incKey, SEC, TEXT) {
        const aW = 9, gap = 4, numW = 34;
        const x0 = rightX - (aW + gap + numW + gap + aW);
        const cy = y + h / 2;
        ctx.textAlign = "center";
        ctx.fillStyle = SEC; ctx.fillText("◀", x0 + aW / 2, cy);
        ctx.fillStyle = TEXT; ctx.fillText((Number(val) || 0).toFixed(2), x0 + aW + gap + numW / 2, cy);
        ctx.fillStyle = SEC; ctx.fillText("▶", x0 + aW + gap + numW + gap + aW / 2, cy);
        ctx.textAlign = "left";
        this.hit[decKey] = [x0, y, aW + gap / 2, h];
        this.hit[valKey] = [x0 + aW + gap, y, numW, h];
        this.hit[incKey] = [x0 + aW + gap + numW + gap / 2, y, aW + gap / 2, h];
        return x0;
    }

    drawLoraLine(ctx, tag, side, loraName, strength, auto, left, right, ry, TEXT, SEC) {
        const cy = ry + ROW_H / 2;
        ctx.fillStyle = SEC;
        ctx.fillText(tag, left, cy);
        const dk = side === "high" ? "hDec" : "lDec";
        const vk = side === "high" ? "hVal" : "lVal";
        const ik = side === "high" ? "hInc" : "lInc";
        const nameKey = side === "high" ? "lora_high" : "lora_low";
        const strLeft = this.drawStrength(ctx, right, ry, ROW_H, strength, dk, vk, ik, SEC, TEXT);
        const nameX = left + 14;
        const nameW = strLeft - 8 - nameX;
        const isSet = loraName && loraName !== "None";
        ctx.fillStyle = !isSet ? SEC : (auto ? "#7fb2e0" : TEXT);
        const text = (isSet ? shortName(loraName) : "click to choose…") + (auto ? "  ⟲" : "");
        ctx.fillText(fitString(ctx, text, nameW), nameX, cy);
        this.hit[nameKey] = [nameX, ry, nameW, ROW_H];
    }

    step(key, dir) {
        const v = Math.round((Number(this.value[key] || 0) + dir * 0.05) * 100) / 100;
        this.value[key] = Math.max(-100, Math.min(100, v));
    }
    promptValue(key, node, event) {
        app.canvas.prompt("Strength", (Number(this.value[key]) || 0).toFixed(2), (val) => {
            const n = parseFloat(val);
            if (!isNaN(n)) { this.value[key] = Math.max(-100, Math.min(100, n)); node.setDirtyCanvas(true, true); }
        }, event);
    }
    openChooser(slot, node, event) {
        const slotAutoKey = slot === "lora_high" ? "_autoHigh" : "_autoLow";
        const other = slot === "lora_high" ? "lora_low" : "lora_high";
        const otherAutoKey = other === "lora_low" ? "_autoLow" : "_autoHigh";
        showLoraChooser(event, this.value[slot], (val) => {
            // Capture the edited slot's state BEFORE applying the pick.
            const oldVal = this.value[slot];
            const editedWasWhite = oldVal && oldVal !== "None" && !this.value[slotAutoKey];

            // Apply the pick; this slot is now a manual (white) value.
            this.value[slot] = val;
            this.value[slotAutoKey] = false;

            const otherEmpty = !this.value[other] || this.value[other] === "None";
            const otherAuto = !!this.value[otherAutoKey];
            // "Update both" unless we're editing a slot that was empty/blue AND
            // the counterpart is a manual (white) value — then protect it.
            const allowOverwrite = otherEmpty || otherAuto || editedWasWhite;

            if (val && val !== "None") {
                if (allowOverwrite) {
                    let cp = null;
                    try { cp = findCounterpart(val, LORA_LIST); }
                    catch (e) { console.warn("[MoBo KeywordLoraStacker] auto-match failed", e); }
                    if (cp) {
                        this.value[other] = cp;
                        this.value[otherAutoKey] = true;
                    } else if (otherAuto) {
                        // Stale auto value with no match for the new pick — drop it.
                        this.value[other] = "None";
                        this.value[otherAutoKey] = false;
                    }
                    // (empty stays empty; a forced white counterpart with no match is left as-is)
                }
            } else if (otherAuto) {
                // Cleared this slot to None and the other was auto from it — clear too.
                this.value[other] = "None";
                this.value[otherAutoKey] = false;
            }
            node.setDirtyCanvas(true, true);
        });
    }
    editKeyword(node, event) {
        app.canvas.prompt("Keyword(s)  (, ; or newline = OR; blank = always)", this.value.keyword || "", (val) => {
            this.value.keyword = (val ?? "").toString();
            node.setDirtyCanvas(true, true);
        }, event);
    }

    mouse(event, pos, node) {
        const t = event.type;
        if (t === "pointerdown" || t === "mousedown") {
            if (event.button === 2) return false;            // let the context menu handle right-click
            if (inside(pos, this.hit.toggle)) { this.value.on = !this.value.on; node.setDirtyCanvas(true, true); return true; }
            if (inside(pos, this.hit.hDec)) { this.step("strengthHigh", -1); node.setDirtyCanvas(true, true); return true; }
            if (inside(pos, this.hit.hInc)) { this.step("strengthHigh", 1); node.setDirtyCanvas(true, true); return true; }
            if (inside(pos, this.hit.lDec)) { this.step("strengthLow", -1); node.setDirtyCanvas(true, true); return true; }
            if (inside(pos, this.hit.lInc)) { this.step("strengthLow", 1); node.setDirtyCanvas(true, true); return true; }
            if (inside(pos, this.hit.lora_high)) { this.openChooser("lora_high", node, event); return true; }
            if (inside(pos, this.hit.lora_low)) { this.openChooser("lora_low", node, event); return true; }
            if (inside(pos, this.hit.keyword)) { this.editKeyword(node, event); return true; }
            if (inside(pos, this.hit.hVal)) { this._drag = { key: "strengthHigh", x: pos[0], v: Number(this.value.strengthHigh) || 0, moved: false }; return true; }
            if (inside(pos, this.hit.lVal)) { this._drag = { key: "strengthLow", x: pos[0], v: Number(this.value.strengthLow) || 0, moved: false }; return true; }
            return false;
        }
        if (t === "pointermove" || t === "mousemove") {
            if (this._drag) {
                const dx = pos[0] - this._drag.x;
                if (Math.abs(dx) > 2) this._drag.moved = true;
                this.value[this._drag.key] = Math.max(-100, Math.min(100, Math.round((this._drag.v + dx * 0.05) * 100) / 100));
                node.setDirtyCanvas(true, true);
                return true;
            }
            return false;
        }
        if (t === "pointerup" || t === "mouseup") {
            if (this._drag) {
                const d = this._drag; this._drag = null;
                if (!d.moved) this.promptValue(d.key, node, event);
                return true;
            }
            return false;
        }
        return false;
    }
}

/* ------------------------------------------------------------------ */
/* Collapsible prompt helpers                                         */
/* ------------------------------------------------------------------ */
function hideWidget(w) {
    if (!w || w._moboHidden) return;
    w._moboHidden = true;
    w._moboOrig = { type: w.type, computeSize: w.computeSize, draw: w.draw, mouse: w.mouse };
    w.type = "hidden";
    w.computeSize = () => [0, -4];
    w.draw = () => {};
    w.mouse = () => false;
    if (w.element) w.element.style.display = "none";
}
function showWidget(w) {
    if (!w || !w._moboHidden) return;
    w._moboHidden = false;
    const o = w._moboOrig;
    w.type = o.type;
    if (o.computeSize) w.computeSize = o.computeSize; else delete w.computeSize;
    if (o.draw) w.draw = o.draw; else delete w.draw;
    if (o.mouse) w.mouse = o.mouse; else delete w.mouse;
    if (w.element) w.element.style.display = "";
}

/* ------------------------------------------------------------------ */
/* Extension                                                          */
/* ------------------------------------------------------------------ */
app.registerExtension({
    name: "MoBoNodes.KeywordLoraStacker",

    async beforeRegisterNodeDef(nodeType, nodeDef) {
        if (nodeDef.name !== "KeywordLoraStacker") return;
        getLoraList();

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origCreated?.apply(this, arguments);
            const node = this;
            node.properties = node.properties || {};
            if (!Array.isArray(node.properties.moboLoraRows)) node.properties.moboLoraRows = [];

            const promptW = node.widgets?.find((w) => w.name === "prompt");
            const stackKwW = node.widgets?.find((w) => w.name === "stack_keyword");

            const loraWidgets = () => node.widgets.filter((w) => w.type === WTYPE);
            const renumber = () => loraWidgets().forEach((w, i) => (w.name = `lora_${i + 1}`));

            function insertLora(value) {
                const w = new LoraEntryWidget(value);
                const idx = node.widgets.indexOf(addBtn);
                if (idx >= 0) node.widgets.splice(idx, 0, w); else node.widgets.push(w);
                renumber();
                return w;
            }
            function removeLora(w) {
                const i = node.widgets.indexOf(w);
                if (i >= 0) node.widgets.splice(i, 1);
                renumber(); fit();
            }
            function moveLora(w, dir) {
                const ws = node.widgets, i = ws.indexOf(w), j = i + dir;
                if (j < 0 || j >= ws.length || ws[j].type !== WTYPE) return;
                [ws[i], ws[j]] = [ws[j], ws[i]];
                renumber(); node.setDirtyCanvas(true, true);
            }
            function fit() {
                const minH = node.computeSize()[1];
                if ((node.size?.[1] || 0) < minH) node.setSize([node.size[0], minH]);
                node.setDirtyCanvas(true, true);
            }
            node._moboRemoveLora = removeLora;
            node._moboMoveLora = moveLora;

            // Collapsible prompt
            let promptExpanded = node.properties.moboPromptExpanded !== false;
            const collapseBtn = node.addWidget("button", promptExpanded ? "▼ Prompt" : "▶ Prompt", null, () => setPromptExpanded(!promptExpanded));
            collapseBtn.serialize = false;
            function setPromptExpanded(exp) {
                promptExpanded = exp;
                node.properties.moboPromptExpanded = exp;
                if (exp) showWidget(promptW); else hideWidget(promptW);
                collapseBtn.name = exp ? "▼ Prompt" : "▶ Prompt";
                fit();
            }
            { const bi = node.widgets.indexOf(collapseBtn); if (bi > 0) { node.widgets.splice(bi, 1); node.widgets.unshift(collapseBtn); } }

            // Add LoRA button (stays at bottom; loras insert before it)
            const addBtn = node.addWidget("button", "➕ Add LoRA", null, () => {
                const row = defaultRow();
                node.properties.moboLoraRows.push(row);
                insertLora(row);
                fit();
            });
            addBtn.serialize = false;

            function rebuild(rowsArr) {
                node.widgets = node.widgets.filter((w) => w.type !== WTYPE);
                node.properties.moboLoraRows = (rowsArr || []).map((x) => ({ ...defaultRow(), ...x }));
                for (const row of node.properties.moboLoraRows) insertLora(row);
                getLoraList().then(() => fit());
            }

            // Persistence (name-based; robust against positional scramble)
            const origSerialize = node.onSerialize;
            node.onSerialize = function (o) {
                origSerialize?.apply(this, arguments);
                o.properties = o.properties || {};
                // Note: auto-match (blue) flags are intentionally NOT persisted —
                // on reload, restored LoRAs are treated as committed/manual values.
                o.properties.moboLoraRows = loraWidgets().map((w) => w.serializeValue());
                o.properties.moboPromptExpanded = promptExpanded;
                o.properties.moboNamed = { prompt: promptW?.value, stack_keyword: stackKwW?.value };
            };
            const origConfigure = node.onConfigure;
            node.onConfigure = function (info) {
                origConfigure?.call(this, info);
                rebuild(info?.properties?.moboLoraRows || []);
                // Restore static widget values by name (positional restore is unreliable here).
                const named = info?.properties?.moboNamed;
                if (named) {
                    // Use != null so we never assign a null (which later breaks
                    // string ops like prompt.replace during queueing).
                    if (promptW && named.prompt != null) promptW.value = named.prompt;
                    if (stackKwW && named.stack_keyword != null) stackKwW.value = named.stack_keyword;
                }
                if (info?.properties?.moboPromptExpanded === false) setPromptExpanded(false);
            };

            rebuild(node.properties.moboLoraRows);
            return r;
        };

        // Dedicated per-row context menu (rgthree-style): hook getSlotInPosition
        // so a right-click over a LoRA row reports a fake slot, then return that
        // row's own menu from getSlotMenuOptions (a standalone little menu, not
        // items appended to the node's menu).
        const origSlotInPos = nodeType.prototype.getSlotInPosition;
        nodeType.prototype.getSlotInPosition = function (cx, cy) {
            const localY = cy - this.pos[1];
            const w = (this.widgets || []).find((x) => x.type === WTYPE && localY >= x._y0 && localY <= x._y1);
            if (w) return { widget: w, output: { type: "LoRA" } };
            return origSlotInPos ? origSlotInPos.apply(this, arguments) : undefined;
        };
        const origSlotMenu = nodeType.prototype.getSlotMenuOptions;
        nodeType.prototype.getSlotMenuOptions = function (slot) {
            const w = slot?.widget;
            if (w && w.type === WTYPE) {
                const node = this;
                return [
                    { content: "ℹ️ Trigger words (soon)", disabled: true },
                    { content: w.value.on ? "Disable" : "Enable", callback: () => { w.value.on = !w.value.on; node.setDirtyCanvas(true, true); } },
                    null,
                    { content: "⬆️ Move Up", callback: () => node._moboMoveLora(w, -1) },
                    { content: "⬇️ Move Down", callback: () => node._moboMoveLora(w, 1) },
                    null,
                    { content: "🗑️ Remove", callback: () => node._moboRemoveLora(w) },
                ];
            }
            return origSlotMenu ? origSlotMenu.apply(this, arguments) : undefined;
        };
    },
});
