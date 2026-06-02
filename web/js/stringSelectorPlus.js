// String Selector Plus frontend extension.
//
// Mirrors the chosen line into the hidden `selected` widget so
// %StringSelectorPlus.selected% works in SaveImage's filename_prefix.
// Renders a clickable list of every entry with the selected one highlighted,
// and offers a collapsible toggle for the editable `strings` textarea.

import { app } from "../../scripts/app.js";

function parseLines(text) {
    if (!text) return [];
    return String(text)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

// Hide a widget cleanly, remembering its original state so we can restore.
function hideWidget(w) {
    if (!w || w._moboHidden) return;
    w._moboHidden = true;
    w._moboOrig = {
        type: w.type,
        computeSize: w.computeSize,
        draw: w.draw,
        mouse: w.mouse,
    };
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
    if (o.draw)        w.draw        = o.draw;        else delete w.draw;
    if (o.mouse)       w.mouse       = o.mouse;       else delete w.mouse;
    if (w.element) w.element.style.display = "";
}

app.registerExtension({
    name: "MoBoNodes.StringSelectorPlus",

    async beforeRegisterNodeDef(nodeType, nodeDef) {
        if (nodeDef.name !== "StringSelectorPlus") return;

        const origNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origNodeCreated?.apply(this, arguments);
            const node = this;

            const stringsW  = node.widgets.find(w => w.name === "strings");
            const selectW   = node.widgets.find(w => w.name === "select");
            const selectedW = node.widgets.find(w => w.name === "selected");
            if (!stringsW || !selectW) return r;

            // Hide the `selected` widget — it exists only so it gets
            // serialized into the prompt JSON and so %Node.selected% resolves.
            hideWidget(selectedW);

            // --- Collapsible toggle for the `strings` textarea ----------------
            // The list view below it is always visible; the textarea (where
            // you actually edit entries) can be hidden once the list is set
            // up to keep the node compact.
            let entriesExpanded = node.properties?.entriesExpanded ?? true;

            const collapseBtn = node.addWidget("button",
                entriesExpanded ? "▼ Entries (edit)" : "▶ Entries (edit)",
                null,
                () => setEntriesExpanded(!entriesExpanded)
            );
            collapseBtn.serialize = false;

            function setEntriesExpanded(expanded) {
                entriesExpanded = expanded;
                node.properties = node.properties || {};
                node.properties.entriesExpanded = expanded;
                if (expanded) showWidget(stringsW);
                else          hideWidget(stringsW);
                collapseBtn.name = expanded ? "▼ Entries (edit)" : "▶ Entries (edit)";
                // Resize ONLY to grow if the user is currently smaller than the
                // computed minimum — never shrink past their manual resize.
                const minH = node.computeSize()[1];
                if ((node.size?.[1] || 0) < minH) node.setSize?.([node.size[0], minH]);
                app.graph.setDirtyCanvas(true);
            }

            // Reorder so the collapse button sits ABOVE the strings textarea.
            // node.widgets currently is: [select, strings, selected, collapseBtn].
            // We want: [select, collapseBtn, strings, selected].
            const widgets = node.widgets;
            const btnIdx = widgets.indexOf(collapseBtn);
            const strIdx = widgets.indexOf(stringsW);
            if (btnIdx > strIdx) {
                widgets.splice(btnIdx, 1);
                widgets.splice(strIdx, 0, collapseBtn);
            }

            // --- List view (always visible) -----------------------------------
            // listEl fills the wrapper ComfyUI gives it; the wrapper height is
            // computed dynamically from the node's overall height so the list
            // grows when the user resizes the node taller.
            const listEl = document.createElement("div");
            listEl.className = "mobo-string-list";
            listEl.style.cssText = `
                font-family: monospace; font-size: 12px;
                padding: 3px;
                background: #1a1a2e;
                border: 1px solid #444;
                border-radius: 4px;
                box-sizing: border-box;
                width: 100%;
                height: 100%;
                overflow-y: auto;
            `;
            const LIST_H = 160;
            const listWidget = node.addDOMWidget("selected_list", "div", listEl, {
                serialize: false,
                hideOnZoom: false,
                getHeight: () => LIST_H,
            });

            function refresh() {
                const lines = parseLines(stringsW.value);
                listEl.innerHTML = "";
                if (lines.length === 0) {
                    if (selectedW) selectedW.value = "";
                    const empty = document.createElement("div");
                    empty.style.cssText = "color:#777;font-style:italic;padding:4px 8px;";
                    empty.textContent = "(no entries — add one in the Entries field)";
                    listEl.appendChild(empty);
                    return;
                }
                // Wrap the select value visually into [0, count-1] so the
                // INT widget always reflects the actually-resolved index.
                const wrapped = ((selectW.value | 0) % lines.length + lines.length) % lines.length;
                if (selectW.value !== wrapped) selectW.value = wrapped;
                if (selectedW) selectedW.value = lines[wrapped];

                lines.forEach((line, idx) => {
                    const item = document.createElement("div");
                    const isSelected = idx === wrapped;
                    item.style.cssText = `
                        padding: 2px 8px;
                        cursor: pointer;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        border-radius: 2px;
                        ${isSelected
                            ? "background:#4a9eff;color:#fff;font-weight:bold;"
                            : "color:#bbb;"}
                    `;
                    const idxLabel = String(idx).padStart(2, " ");
                    item.textContent = `${idxLabel}  ${line}`;
                    item.title = `Click to select index ${idx}`;
                    item.addEventListener("mouseenter", () => {
                        if (!isSelected) item.style.background = "#2a2a3e";
                    });
                    item.addEventListener("mouseleave", () => {
                        if (!isSelected) item.style.background = "";
                    });
                    item.addEventListener("click", () => {
                        selectW.value = idx;
                        selectW.callback?.(idx);
                        refresh();
                        app.graph.setDirtyCanvas(true);
                    });
                    listEl.appendChild(item);
                });

            }

            // Hook callbacks for change detection.
            // NOTE: do NOT override `widget.draw` on standard ComfyUI INT/STRING
            // widgets — LiteGraph renders them itself when `widget.draw` is
            // unset, and assigning a draw fn that just chains through
            // `origDraw?.apply(...)` replaces that internal renderer with
            // nothing, leaving the widget invisible.
            for (const w of [stringsW, selectW]) {
                const origCb = w.callback;
                w.callback = (...args) => {
                    const out = origCb?.apply(w, args);
                    refresh();
                    app.graph.setDirtyCanvas(true);
                    return out;
                };
                if (typeof w.draw === "function") {
                    const origDraw = w.draw;
                    let last = w.value;
                    w.draw = function (...args) {
                        if (w.value !== last) {
                            last = w.value;
                            refresh();
                        }
                        return origDraw.apply(this, args);
                    };
                }
            }

            // --- Name-based save/load -----------------------------------------
            // ComfyUI's default serialization is positional. We reorder widgets
            // (collapse button between select and strings) and hide some, which
            // breaks the positional mapping across save/load. Save by name into
            // node.properties and restore the same way — robust to reordering
            // and to widget-existence differences across versions.
            const NAMED_WIDGETS = ["select", "strings", "selected"];
            const origOnSerialize = node.onSerialize;
            node.onSerialize = function (o) {
                origOnSerialize?.apply(this, arguments);
                o.properties = o.properties || {};
                const named = {};
                for (const name of NAMED_WIDGETS) {
                    const w = this.widgets.find(x => x.name === name);
                    if (w) named[name] = w.value;
                }
                o.properties.moboNamed = named;
            };

            const origOnConfigure = node.onConfigure;
            node.onConfigure = function (info) {
                origOnConfigure?.call(this, info);
                // Name-based restore overrides any positionally-scrambled values.
                if (info.properties?.moboNamed) {
                    for (const [name, value] of Object.entries(info.properties.moboNamed)) {
                        const w = this.widgets.find(x => x.name === name);
                        if (w && value !== undefined) w.value = value;
                    }
                }
                if (info.properties?.entriesExpanded === false) {
                    setEntriesExpanded(false);
                }
                refresh();
            };

            // Apply initial collapsed state (in case loaded with collapsed=false)
            if (!entriesExpanded) setEntriesExpanded(false);
            refresh();
            return r;
        };
    },
});
