import { app } from "../../scripts/app.js";
import { openCropEditor } from "./cropEditor.js";
import { STANDARD_RATIOS, findClosestStandardRatio } from "./cropEditor.js";

const PREVIEW_HEIGHT = 220;
const GAP = 6;

// --- Widget show/hide helpers ------------------------------------------------

function hideWidget(w) {
    if (w._moboHidden) return;
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
    if (!w._moboHidden) return;
    w._moboHidden = false;
    const o = w._moboOrig;
    w.type = o.type;
    if (o.computeSize) w.computeSize = o.computeSize; else delete w.computeSize;
    if (o.draw) w.draw = o.draw; else delete w.draw;
    if (o.mouse) w.mouse = o.mouse; else delete w.mouse;
    if (w.element) w.element.style.display = "";
}

// --- Ratio helpers -----------------------------------------------------------

const RATIO_TUPLES = {};
for (const [name] of Object.entries(STANDARD_RATIOS)) {
    const parts = name.split(":");
    RATIO_TUPLES[name] = [parseInt(parts[0]), parseInt(parts[1])];
}

// --- Resolution computation (mirrors Python logic) ---------------------------

const RESOLUTION_MAP = {
    "240p": 240, "280p": 280, "304p": 304, "320p": 320, "360p": 360,
    "400p": 400, "416p": 416, "480p": 480, "504p": 504, "576p": 576,
    "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160,
};

function computeResolution(rw, rh, targetSide, divisibleBy, longestSide = false) {
    let w, h;
    const portrait = rw <= rh;
    if (longestSide) {
        if (portrait) {
            h = targetSide;
            w = Math.round(h * rw / rh);
        } else {
            w = targetSide;
            h = Math.round(w * rh / rw);
        }
    } else {
        if (portrait) {
            w = targetSide;
            h = Math.round(w * rh / rw);
        } else {
            h = targetSide;
            w = Math.round(h * rw / rh);
        }
    }
    w = Math.max(divisibleBy, Math.floor(w / divisibleBy) * divisibleBy);
    h = Math.max(divisibleBy, Math.floor(h / divisibleBy) * divisibleBy);
    return { w, h };
}

function computeTargetDims(imgW, imgH, aspectRatio, preset, customRes, snapTo8, longestSide = false) {
    let rw, rh;
    if (aspectRatio === "From input") {
        if (imgW > 0 && imgH > 0) {
            const matched = findClosestStandardRatio(imgW, imgH).name;
            [rw, rh] = RATIO_TUPLES[matched];
        } else {
            rw = 1; rh = 1;
        }
    } else {
        [rw, rh] = RATIO_TUPLES[aspectRatio] || [1, 1];
    }

    if (preset === "From input") {
        if (aspectRatio === "From input" && imgW > 0 && imgH > 0) {
            return { w: imgW, h: imgH };
        }
        const side = longestSide
            ? (Math.max(imgW, imgH) > 0 ? Math.max(imgW, imgH) : 512)
            : (Math.min(imgW, imgH) > 0 ? Math.min(imgW, imgH) : 512);
        return computeResolution(rw, rh, side, snapTo8 ? 8 : 1, longestSide);
    }

    const side = preset in RESOLUTION_MAP ? RESOLUTION_MAP[preset] : customRes;
    return computeResolution(rw, rh, side, snapTo8 ? 8 : 1, longestSide);
}

function getResolvedRatioName(aspectValue, imgW, imgH) {
    if (aspectValue === "From input" && imgW > 0 && imgH > 0) {
        return findClosestStandardRatio(imgW, imgH).name;
    }
    return aspectValue;
}

// --- fileid: must match Python image_loader_plus.generate_fileid() -----------
const FILE_ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

function simpleHash5(s) {
    // Polynomial rolling hash clamped to uint64, then 5-char base36.
    let h = 0n;
    const MASK = 0xFFFFFFFFFFFFFFFFn;
    for (let i = 0; i < s.length; i++) {
        h = (h * 131n + BigInt(s.charCodeAt(i))) & MASK;
    }
    let out = "";
    for (let i = 0; i < 5; i++) {
        out = FILE_ID_CHARS[Number(h % 36n)] + out;
        h = h / 36n;
    }
    return out;
}

function generateFileId(_subfolder, filename) {
    // Just the 5-char hash — folder info not included here.
    // (Use FilenameBuilder's {folder} variable if you want folder segments in the output.)
    if (!filename || filename === "none") return "";
    return simpleHash5(filename);
}

// =============================================================================

app.registerExtension({
    name: "mobo.ImageLoaderPlus",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "LoadImagePlus") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            const node = this;
            const useOutputW     = node.widgets.find(w => w.name === "use_output_dir");
            const subfolderWidget = node.widgets.find(w => w.name === "subfolder");
            const imageWidget     = node.widgets.find(w => w.name === "image");
            const aspectW         = node.widgets.find(w => w.name === "aspect_ratio");
            const resPre          = node.widgets.find(w => w.name === "resolution_preset");
            const resTgt          = node.widgets.find(w => w.name === "target_resolution");
            const snapTo8W        = node.widgets.find(w => w.name === "snap_to_8");
            const longestSideW    = node.widgets.find(w => w.name === "longest_side");
            const subfolderIdW    = node.widgets.find(w => w.name === "subfolderid");
            const fileidInputW    = node.widgets.find(w => w.name === "fileid");
            const outfileTplW     = node.widgets.find(w => w.name === "outfile_template");
            const outfolderTplW   = node.widgets.find(w => w.name === "outfolder_template");
            const outfileW        = node.widgets.find(w => w.name === "outfile");
            const outfolderW      = node.widgets.find(w => w.name === "outfolder");
            if (!useOutputW || !subfolderWidget || !imageWidget || !aspectW || !resPre || !resTgt || !snapTo8W || !subfolderIdW) return;

            // Hide the subfolderid widget — auto-populated by JS
            hideWidget(subfolderIdW);
            // Hide outfile/outfolder widgets (the RESOLVED values) — only for %Node.widget% substitution
            if (outfileW)   hideWidget(outfileW);
            if (outfolderW) hideWidget(outfolderW);
            // fileid stays visible as a live-updated read-only display

            function getSubfolderIdValue() {
                const real = realPathFor(subfolderWidget.value);
                if (!real || real === ".") return "";
                return real
                    .replace(/\\/g, "/")
                    .replace(/^\/+|\/+$/g, "")
                    .replace(/\//g, "-");
            }

            function updateSubfolderId() {
                subfolderIdW.value = getSubfolderIdValue();
            }

            // --- Live template resolution for outfile/outfolder --------------

            function getAspectDashed() {
                const w = node._moboImgW, h = node._moboImgH;
                if (!w || !h) return "";
                return findClosestStandardRatio(w, h).name.replace(":", "x");
            }

            function getFilenameStem(filename) {
                if (!filename || filename === "none") return "";
                const dot = filename.lastIndexOf(".");
                return dot > 0 ? filename.substring(0, dot) : filename;
            }

            function getWorkflowName() {
                // Strip path + extension, return plain name. Empty if unknown.
                const pickName = (p) => {
                    if (!p || typeof p !== "string") return "";
                    const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
                    let n = lastSlash >= 0 ? p.substring(lastSlash + 1) : p;
                    const dot = n.lastIndexOf(".");
                    if (dot > 0) n = n.substring(0, dot);
                    return n.trim();
                };
                // Try every known source in preference order. Stop at the first hit.
                const sources = [
                    () => app.workflowManager?.activeWorkflow?.path,
                    () => app.workflowManager?.activeWorkflow?.name,
                    () => app.workflowManager?.activeWorkflow?.filename,
                    () => app.extensionManager?.workflow?.activeWorkflow?.path,
                    () => app.extensionManager?.workflow?.activeWorkflow?.filename,
                    () => app.ui?.settings?.workflow_name,
                    () => app.activeWorkflow?.path,
                    () => app.activeWorkflow?.filename,
                    () => app.graph?.extra?.workflow_name,
                    () => app.graph?.extra?.name,
                    () => app.graph?.filename,
                ];
                for (const getter of sources) {
                    try {
                        const n = pickName(getter());
                        if (n) return n;
                    } catch (e) {}
                }
                // Don't fall back to document.title — during execution ComfyUI
                // sets it to progress markers like "[55%][0%] NodeName" which
                // would pollute filenames. Empty is safer.
                return "";
            }

            function getTemplateVars() {
                const w = node._moboImgW, h = node._moboImgH;
                return {
                    subfolderid: getSubfolderIdValue(),
                    fileid: imageWidget.value && imageWidget.value !== "none"
                        ? simpleHash5(imageWidget.value) : "",
                    filename: getFilenameStem(imageWidget.value),
                    aspect: getAspectDashed(),
                    width:  w ? String(w) : "",
                    height: h ? String(h) : "",
                    res:    (w && h) ? `${w}x${h}` : "",
                    workflowname: getWorkflowName(),
                };
            }

            // Date formatter. Supports yyyy yy MM M dd d hh h mm m ss s — same tokens
            // as ComfyUI's %date:FORMAT% syntax.
            function formatDate(d, fmt) {
                const pad = (n, w) => String(n).padStart(w, "0");
                const tokens = {
                    yyyy: String(d.getFullYear()),
                    yy:   pad(d.getFullYear() % 100, 2),
                    MM:   pad(d.getMonth() + 1, 2),
                    M:    String(d.getMonth() + 1),
                    dd:   pad(d.getDate(), 2),
                    d:    String(d.getDate()),
                    hh:   pad(d.getHours(), 2),
                    h:    String(d.getHours()),
                    mm:   pad(d.getMinutes(), 2),
                    m:    String(d.getMinutes()),
                    ss:   pad(d.getSeconds(), 2),
                    s:    String(d.getSeconds()),
                };
                // Longest tokens first so 'yyyy' wins over 'yy' at the same position.
                return fmt.replace(/yyyy|yy|MM|M|dd|d|hh|h|mm|m|ss|s/g, (m) => tokens[m]);
            }

            function resolveLocalTemplate(template, vars) {
                if (typeof template !== "string" || !template) return "";
                const now = new Date();
                // {date:FORMAT} → formatted current datetime
                let out = template.replace(/\{date:([^}]+)\}/g, (_, fmt) => formatDate(now, fmt));
                // {var} → vars[var] (empty string for unknown)
                out = out.replace(/\{(\w+)\}/g, (_, k) =>
                    vars[k] === undefined || vars[k] === null ? "" : vars[k]);
                return out;
            }

            function cleanLocalString(s) {
                if (typeof s !== "string") return "";
                s = s.replace(/\\/g, "/");
                s = s.replace(/\/+/g, "/");
                s = s.replace(/_+/g, "_");
                s = s.replace(/-+/g, "-");
                return s.replace(/^[\/\-_\s]+|[\/\-_\s]+$/g, "");
            }

            // Resolve the templates from the *_template widgets into the hidden
            // outfile/outfolder widgets. %tokens% (%date:..., %Node.widget%) are
            // preserved so SaveImage can resolve them server-side.
            function updateResolvedOutputs() {
                try {
                    const vars = getTemplateVars();
                    if (outfileW && outfileTplW) {
                        const t = typeof outfileTplW.value === "string" ? outfileTplW.value : "";
                        outfileW.value = cleanLocalString(resolveLocalTemplate(t, vars));
                    }
                    if (outfolderW && outfolderTplW) {
                        const t = typeof outfolderTplW.value === "string" ? outfolderTplW.value : "";
                        outfolderW.value = cleanLocalString(resolveLocalTemplate(t, vars));
                    }
                } catch (e) {
                    console.error("MoBo ImageLoaderPlus: updateResolvedOutputs failed", e);
                }
            }

            // Re-resolve when the user edits the templates
            if (outfileTplW) {
                const origCb = outfileTplW.callback;
                outfileTplW.callback = function(v) {
                    origCb?.call(outfileTplW, v);
                    updateResolvedOutputs();
                };
            }
            if (outfolderTplW) {
                const origCb = outfolderTplW.callback;
                outfolderTplW.callback = function(v) {
                    origCb?.call(outfolderTplW, v);
                    updateResolvedOutputs();
                };
            }


            // Defensive: ensure combo widgets have a valid default value.
            // (Positional widgets_values from older saved workflows can leave these null.)
            function ensureValid(w, fallback) {
                const values = w.options?.values;
                const ok = values ? values.includes(w.value) : (w.value !== null && w.value !== undefined);
                if (!ok) w.value = fallback;
            }
            ensureValid(aspectW, "From input");
            ensureValid(resPre, "320p");
            if (typeof resTgt.value !== "number" || !Number.isFinite(resTgt.value)) {
                resTgt.value = 320;
            }
            if (typeof snapTo8W.value !== "boolean") snapTo8W.value = true;

            // --- State -------------------------------------------------------
            node._moboShowPreview  = true;
            node._moboResExpanded  = false;
            node._moboImgW         = 0;
            node._moboImgH         = 0;
            node._moboSourceType   = (node.properties?.sourceType === "output") ? "output" : "input";

            // Keep backend use_output_dir synced with our hidden source-type state
            useOutputW.value = node._moboSourceType === "output";

            // Hide the boolean widget — users switch source via the subfolder dropdown
            hideWidget(useOutputW);

            // --- Reorder widgets ---------------------------------------------
            // Remove resolution + output-name section widgets from default order.
            // (outfileW and outfolderW are the hidden RESOLVED widgets — we'll keep them
            //  in place but permanently hidden. Templates go into the Output Name section.)
            node.widgets = node.widgets.filter(w =>
                w !== aspectW && w !== resPre && w !== resTgt && w !== snapTo8W && w !== longestSideW
                && w !== outfileTplW && w !== outfolderTplW
            );

            // --- Mode switch labels for the subfolder dropdown ---------------
            const MODE_LABELS = {
                "input":  { active: "● [input]",  inactive: "○ [input]"  },
                "output": { active: "● [output]", inactive: "○ [output]" },
            };

            function isModeSwitchLabel(v) {
                return typeof v === "string" && /\[(input|output)\]\s*$/.test(v);
            }

            function modeFromLabel(v) {
                if (typeof v !== "string") return null;
                if (v.includes("[input]"))  return "input";
                if (v.includes("[output]")) return "output";
                return null;
            }

            function buildSubfolderList(activeSource, realFolders) {
                const iMark = activeSource === "input"  ? MODE_LABELS.input.active  : MODE_LABELS.input.inactive;
                const oMark = activeSource === "output" ? MODE_LABELS.output.active : MODE_LABELS.output.inactive;
                return [iMark, oMark, ...realFolders];
            }

            function setSubfolderList(list) {
                Object.defineProperty(subfolderWidget.options, "values", {
                    get() { return list; }, configurable: true,
                });
            }

            // --- Display-label ↔ real-path mapping for subfolders -----------
            // Display: "dogs  (9)".  Real path sent to Python: "dogs".
            let pathsByDisplay = {};   // display string -> real folder path

            function displayFor(path, count) {
                return `${path}  (${count})`;
            }

            function stripCount(v) {
                if (typeof v !== "string") return v;
                return v.replace(/\s*\(\d+\)\s*$/, "");
            }

            function realPathFor(value) {
                if (isModeSwitchLabel(value)) return null;
                if (value in pathsByDisplay) return pathsByDisplay[value];
                // Fallback: strip count suffix (handles saved workflows with stale counts)
                const stripped = stripCount(value);
                if (Object.values(pathsByDisplay).includes(stripped)) return stripped;
                return stripped; // best effort
            }

            // Send the real path (without " (N)") to Python
            subfolderWidget.serializeValue = async function () {
                const real = realPathFor(subfolderWidget.value);
                return real === null ? "." : real;
            };

            // Initialize the subfolder dropdown with mode switches + current values
            // so the node displays sensible content before the async refresh resolves.
            {
                const initial = subfolderWidget.options?.values || [];
                const hasRealFolders = Array.isArray(initial) && initial.length > 0 && !initial.some(isModeSwitchLabel);
                setSubfolderList(buildSubfolderList(node._moboSourceType, hasRealFolders ? initial : ["."]));
                if (isModeSwitchLabel(subfolderWidget.value) || !subfolderWidget.value) {
                    subfolderWidget.value = ".";
                }
            }

            // --- Control after generate (cycle image for batch processing) ---
            const controlW = node.addWidget(
                "combo",
                "After generate",
                node.properties?.controlAfterGenerate || "fixed",
                (value) => {
                    node.properties = node.properties || {};
                    node.properties.controlAfterGenerate = value;
                },
                { values: ["fixed", "increment", "decrement", "randomize"] }
            );
            // This widget is UI-only, not a node input — don't serialize it to the prompt
            controlW.serialize = false;

            // --- fileid is computed but hidden ---------------------------------
            // The widget still exists (so %LoadImagePlus.fileid% resolves in
            // SaveImage filename_prefix), but we keep it off-screen — its
            // contents are derived from the filename and don't need to be edited.
            const fileidWidget = fileidInputW;  // alias for clarity
            if (fileidWidget) hideWidget(fileidWidget);

            function updateFileidDisplay() {
                if (!fileidWidget) return;
                const filename = imageWidget.value;
                fileidWidget.value = (filename && filename !== "none") ? simpleHash5(filename) : "";
                app.graph.setDirtyCanvas(true);
            }

            // --- Archive Image button -----------------------------------------
            // Moves the currently-selected file into an `archive/` subfolder
            // alongside it (created if missing), then refreshes the list and
            // advances to the next image so batch-processing flow continues.
            const archiveBtn = node.addWidget("button", "🗄 Archive image", null, async () => {
                const filename = imageWidget.value;
                if (!filename || filename === "none") {
                    archiveBtn.name = "🗄 Archive image";
                    return;
                }
                const realSub = realPathFor(subfolderWidget.value) ?? ".";
                const subForAPI = realSub === "." ? "" : realSub;
                archiveBtn.name = "⏳ Archiving…";
                app.graph.setDirtyCanvas(true);
                try {
                    const resp = await fetch("/mobo_nodes/image_loader/archive", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            type: sourceType(),
                            subfolder: subForAPI,
                            filename,
                        }),
                    });
                    const json = await resp.json();
                    if (!resp.ok || !json.ok) throw new Error(json.error || `HTTP ${resp.status}`);
                    archiveBtn.name = `✅ → archive/${json.new_filename}`;
                    // Pick the next image in the current folder so the user
                    // can keep working without re-selecting manually.
                    const list = imageWidget.options.values || [];
                    const idx  = list.indexOf(filename);
                    const nextSelect = list[(idx >= 0 ? idx + 1 : 0) % Math.max(1, list.length)];
                    await refreshImages(subfolderWidget.value, nextSelect);
                    // Counts in the subfolder dropdown have changed (one
                    // moved out of the source, +1 in archive/) — refresh.
                    refreshSubfolders().catch(() => {});
                } catch (e) {
                    console.error("Archive failed:", e);
                    archiveBtn.name = "❌ Archive failed";
                }
                setTimeout(() => {
                    archiveBtn.name = "🗄 Archive image";
                    app.graph.setDirtyCanvas(true);
                }, 2500);
                app.graph.setDirtyCanvas(true);
            });
            archiveBtn.serialize = false;

            // Move the Archive button to where the now-hidden `fileid` field
            // used to sit visually (right under the image dropdown), instead
            // of being appended at the end of the widget list.
            {
                const ws = node.widgets;
                const btnIdx = ws.indexOf(archiveBtn);
                if (btnIdx >= 0) {
                    ws.splice(btnIdx, 1);
                    const imgIdx = ws.indexOf(imageWidget);
                    const insertAt = imgIdx >= 0 ? imgIdx + 1 : ws.length;
                    ws.splice(insertAt, 0, archiveBtn);
                }
            }

            function advanceImage() {
                const mode = controlW.value;
                if (mode === "fixed") return;
                const list = imageWidget.options.values;
                if (!list || list.length <= 1) return;
                const currentIdx = Math.max(0, list.indexOf(imageWidget.value));
                let nextIdx;
                if (mode === "increment") {
                    nextIdx = (currentIdx + 1) % list.length;
                } else if (mode === "decrement") {
                    nextIdx = (currentIdx - 1 + list.length) % list.length;
                } else { // randomize
                    if (list.length === 1) { nextIdx = 0; }
                    else {
                        do { nextIdx = Math.floor(Math.random() * list.length); }
                        while (nextIdx === currentIdx);
                    }
                }
                imageWidget.value = list[nextIdx];
                imageWidget.callback?.(list[nextIdx]);
            }

            // Advance image after each queue by hooking the image widget's
            // serializeValue — this is the same pattern ComfyUI uses for
            // the built-in seed "control_after_generate" behavior.
            //   - On each queue submission, serializeValue returns the current
            //     image (sent to Python), then schedules the advance for next time.
            //   - Works for single queues AND batch_count > 1 (each batch item
            //     re-serializes the graph, so each gets a different image).
            const origSerializeImage = imageWidget.serializeValue;
            imageWidget.serializeValue = async function (...args) {
                const v = origSerializeImage
                    ? await origSerializeImage.apply(this, args)
                    : imageWidget.value;
                // Defer advance to after current serialization completes
                setTimeout(() => {
                    advanceImage();
                    app.graph.setDirtyCanvas(true);
                }, 0);
                return v;
            };

            // --- Helpers -----------------------------------------------------

            const sourceType = () => node._moboSourceType;

            function setSourceType(source) {
                node._moboSourceType = source;
                node.properties = node.properties || {};
                node.properties.sourceType = source;
                useOutputW.value = (source === "output"); // sync hidden backend input
            }

            function applyHeight() {
                // node.computeSize() already includes the DOM preview's
                // contribution (via getHeight) when it's visible. So we just
                // resize to that. PREVIEW_HEIGHT is added/removed by the
                // toggle setting the wrapper's display style.
                node.size[1] = node.computeSize()[1];
            }

            function updateSectionLabel() {
                const { w, h } = computeTargetDims(
                    node._moboImgW, node._moboImgH,
                    aspectW.value, resPre.value, resTgt.value, snapTo8W.value,
                    !!longestSideW?.value
                );
                const arrow = node._moboResExpanded ? "▼" : "▶";
                const rName = getResolvedRatioName(aspectW.value, node._moboImgW, node._moboImgH);
                const dimPart = node._moboImgW
                    ? `  ·  ${w}×${h}  (${rName})`
                    : "";
                sectionToggle.name = `${arrow} Output Resolution${dimPart}`;
                // Aspect / resolution changes affect {aspect}/{width}/{height}/{res} — re-resolve templates
                updateResolvedOutputs();
            }

            function setSectionExpanded(expanded) {
                node._moboResExpanded = expanded;
                node.properties = node.properties || {};
                node.properties.resExpanded = expanded;
                if (expanded) {
                    showWidget(aspectW);
                    showWidget(resPre);
                    if (resPre.value === "Custom") showWidget(resTgt); else hideWidget(resTgt);
                    showWidget(snapTo8W);
                    if (longestSideW) showWidget(longestSideW);
                } else {
                    hideWidget(aspectW);
                    hideWidget(resPre);
                    hideWidget(resTgt);
                    hideWidget(snapTo8W);
                    if (longestSideW) hideWidget(longestSideW);
                }
                updateSectionLabel();
                applyHeight();
                app.graph.setDirtyCanvas(true);
            }

            // --- Preview DOM element refs (assigned later in node setup) ----
            let _previewImg = null, _previewWrap = null;

            // --- Image probe (always fetch dimensions, even when preview off) ---

            const probeImage = (subfolder, filename) => {
                if (!filename || filename === "none") {
                    node._moboImgW = 0;
                    node._moboImgH = 0;
                    if (_previewImg) _previewImg.src = "";
                    updateSectionLabel();
                    applyHeight();
                    app.graph.setDirtyCanvas(true);
                    return;
                }
                const realSub = realPathFor(subfolder) ?? ".";
                const sub = realSub === "." ? "" : realSub;
                const url = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(sub)}&type=${sourceType()}&rand=${Math.random()}`;
                const img = new Image();
                img.onload = () => {
                    node._moboImgW = img.naturalWidth;
                    node._moboImgH = img.naturalHeight;
                    if (_previewImg) {
                        _previewImg.src = node._moboShowPreview ? url : "";
                    }
                    updateSectionLabel();
                    applyHeight();
                    app.graph.setDirtyCanvas(true);
                };
                img.onerror = () => {
                    if (_previewImg) _previewImg.src = "";
                    applyHeight();
                    app.graph.setDirtyCanvas(true);
                };
                img.src = url;
            };

            // --- Subfolder / image list refresh ------------------------------

            const refreshSubfolders = async () => {
                try {
                    const resp = await fetch(`/mobo_nodes/image_loader/subfolders?type=${sourceType()}&with_counts=1`);
                    const folders = await resp.json(); // [{path, count}]
                    // Rebuild display ↔ real-path map and display list
                    pathsByDisplay = {};
                    const displayFolders = folders.map(f => {
                        const d = displayFor(f.path, f.count);
                        pathsByDisplay[d] = f.path;
                        return d;
                    });
                    const list = buildSubfolderList(sourceType(), displayFolders);
                    setSubfolderList(list);

                    // Migrate current widget value to new display string if needed
                    const currentReal = realPathFor(subfolderWidget.value);
                    if (!list.includes(subfolderWidget.value)) {
                        // Try to find the matching new display for the current real path
                        const match = Object.keys(pathsByDisplay).find(d => pathsByDisplay[d] === currentReal);
                        if (match) {
                            subfolderWidget.value = match;
                        } else {
                            // Fall back to root display, or first real folder
                            const rootDisplay = Object.keys(pathsByDisplay).find(d => pathsByDisplay[d] === ".");
                            subfolderWidget.value = rootDisplay || displayFolders[0] || ".";
                        }
                    }
                } catch (e) { console.error("MoBo ImageLoaderPlus: failed to fetch subfolders", e); }
            };

            const refreshImages = async (subfolderValue, selectFilename = null) => {
                try {
                    const realSub = realPathFor(subfolderValue) ?? ".";
                    const resp = await fetch(`/mobo_nodes/image_loader/images?subfolder=${encodeURIComponent(realSub)}&type=${sourceType()}`);
                    const images = await resp.json();
                    const list = images.length > 0 ? images : ["none"];
                    Object.defineProperty(imageWidget.options, "values", {
                        get() { return list; }, configurable: true,
                    });
                    imageWidget.value = (selectFilename && list.includes(selectFilename)) ? selectFilename : list[0];
                    probeImage(subfolderValue, imageWidget.value);
                    updateFileidDisplay();
                    updateSubfolderId();
                    updateResolvedOutputs();
                } catch (e) { console.error("MoBo ImageLoaderPlus: failed to fetch images", e); }
            };

            // --- Switch between input/output with a "Loading…" placeholder ---
            async function switchSourceMode(newSource) {
                // Temporary loading state in the subfolder dropdown
                setSubfolderList(["Loading…"]);
                subfolderWidget.value = "Loading…";
                app.graph.setDirtyCanvas(true);
                setSourceType(newSource);
                await refreshSubfolders();
                // After refresh, select the root of the new source
                const rootDisplay = Object.keys(pathsByDisplay).find(d => pathsByDisplay[d] === ".") || ".";
                subfolderWidget.value = rootDisplay;
                await refreshImages(rootDisplay);
                app.graph.setDirtyCanvas(true);
            }

            // --- Upload logic (shared with drag-drop + Upload button) --------

            async function doUpload(files) {
                if (!files.length) return;
                // Uploads always go to input folder — switch if currently viewing output
                if (sourceType() === "output") {
                    await switchSourceMode("input");
                }
                uploadButton.name = "⏳ Uploading…";
                app.graph.setDirtyCanvas(true);
                let lastFilename = null;
                for (const file of files) {
                    try {
                        const realSub = realPathFor(subfolderWidget.value) ?? ".";
                        const subfolder = realSub === "." ? "" : realSub;
                        const fd = new FormData();
                        fd.append("image", file); fd.append("subfolder", subfolder);
                        fd.append("type", "input"); fd.append("overwrite", "false");
                        const resp = await fetch("/upload/image", { method: "POST", body: fd });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        lastFilename = (await resp.json()).name;
                    } catch (e) { console.error("MoBo ImageLoaderPlus: upload failed", e); }
                }
                uploadButton.name = "📁 Upload Image";
                await refreshImages(subfolderWidget.value, lastFilename);
                app.graph.setDirtyCanvas(true);
            }

            function triggerFilePicker() {
                const input = document.createElement("input");
                input.type = "file"; input.accept = "image/*"; input.multiple = true;
                input.onchange = () => doUpload(Array.from(input.files));
                input.click();
            }

            // --- Show & Edit button ------------------------------------------

            // --- Upload button (placed just above Edit image) ----------------
            const uploadButton = node.addWidget("button", "📁 Upload Image", null, () => {
                triggerFilePicker();
            });

            // --- Edit image button -------------------------------------------
            node.addWidget("button", "🖼 Edit image", null, () => {
                const filename = imageWidget.value;
                if (!filename || filename === "none") { alert("Select an image first."); return; }
                const realSub = realPathFor(subfolderWidget.value) ?? ".";
                const subfolder = realSub === "." ? "" : realSub;
                const imgUrl = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${sourceType()}`;
                openCropEditor(imgUrl, null, null, null, null, null, filename, subfolder, async (savedName) => {
                    // Save always goes to input folder (uploadCanvas POSTs there)
                    // Switch back to input to find the saved file if we were viewing output
                    if (sourceType() === "output") {
                        await switchSourceMode("input");
                    }
                    await refreshImages(subfolderWidget.value, savedName);
                    app.graph.setDirtyCanvas(true);
                });
            });

            // --- Section toggle (collapsible Output Resolution) --------------

            const sectionToggle = node.addWidget("button", "▶ Output Resolution", null, () => {
                setSectionExpanded(!node._moboResExpanded);
            });

            // Push resolution + aspect ratio widgets after section toggle
            node.widgets.push(aspectW, resPre, resTgt, snapTo8W);
            if (longestSideW) node.widgets.push(longestSideW);

            // Start collapsed
            hideWidget(aspectW); hideWidget(resPre); hideWidget(resTgt); hideWidget(snapTo8W);
            if (longestSideW) hideWidget(longestSideW);

            // --- Section toggle (collapsible Output Name) --------------------
            // Contains the TEMPLATE widgets (user-editable). The resolved
            // outfile/outfolder widgets are permanently hidden (they're just
            // serialization targets for %LoadImagePlus.outfile% / .outfolder%).

            node._moboOutNameExpanded = false;

            function setOutNameExpanded(expanded) {
                node._moboOutNameExpanded = expanded;
                node.properties = node.properties || {};
                node.properties.outNameExpanded = expanded;
                if (expanded) {
                    if (outfileTplW)   showWidget(outfileTplW);
                    if (outfolderTplW) showWidget(outfolderTplW);
                    outNameToggle.name = "▼ Output Name";
                } else {
                    if (outfileTplW)   hideWidget(outfileTplW);
                    if (outfolderTplW) hideWidget(outfolderTplW);
                    outNameToggle.name = "▶ Output Name";
                }
                applyHeight();
                app.graph.setDirtyCanvas(true);
            }

            const outNameToggle = node.addWidget("button", "▶ Output Name", null, () => {
                setOutNameExpanded(!node._moboOutNameExpanded);
            });

            // Push the editable TEMPLATE widgets into the section
            if (outfileTplW)   node.widgets.push(outfileTplW);
            if (outfolderTplW) node.widgets.push(outfolderTplW);

            // Start collapsed — hide the templates
            if (outfileTplW)   hideWidget(outfileTplW);
            if (outfolderTplW) hideWidget(outfolderTplW);

            // Restrict the template textareas to ~2 visible lines so they don't dominate the node
            function shrinkTextarea(w, rows = 2) {
                const el = w?.inputEl || w?.element;
                if (!el) return;
                if (el.tagName === "TEXTAREA") {
                    el.rows = rows;
                }
                el.style.minHeight = "";
                el.style.height = `${rows * 1.5}em`;
                el.style.maxHeight = `${rows * 2.5}em`;
            }
            shrinkTextarea(outfileTplW, 2);
            shrinkTextarea(outfolderTplW, 2);

            // --- Show Preview toggle (placed AFTER the Output Resolution section, right above the preview) ---

            const previewToggle = node.addWidget("toggle", "Show Preview", true, (value) => {
                node._moboShowPreview = value;
                node.properties = node.properties || {};
                node.properties.showPreview = value;
                if (_previewWrap) _previewWrap.style.display = value ? "" : "none";
                if (value) {
                    probeImage(subfolderWidget.value, imageWidget.value);
                }
                applyHeight();
                app.graph.setDirtyCanvas(true);
            });

            // --- Preview as a DOM widget with fixed height -------------------
            // Using a DOM widget instead of `node.imgs = [img]` so the preview
            // area stays a constant height regardless of image aspect ratio.
            // (ComfyUI's built-in `node.imgs` auto-fits the node to the
            // image's aspect, which made the node grow/shrink per image.)
            _previewWrap = document.createElement("div");
            _previewWrap.style.cssText = `
                width: 100%;
                height: ${PREVIEW_HEIGHT}px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #1a1a2e;
                border: 1px solid #333;
                border-radius: 4px;
                overflow: hidden;
                box-sizing: border-box;
            `;
            _previewImg = document.createElement("img");
            _previewImg.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                display: block;
            `;
            _previewWrap.appendChild(_previewImg);
            const _previewWidget = node.addDOMWidget("preview", "div", _previewWrap, {
                serialize: false,
                hideOnZoom: false,
                getHeight: () => PREVIEW_HEIGHT,
            });

            // --- Widget callbacks --------------------------------------------

            const origAspectCb = aspectW.callback;
            aspectW.callback = (value) => {
                origAspectCb?.call(node, value);
                updateSectionLabel();
                app.graph.setDirtyCanvas(true);
            };

            // Coerce any value (string, preset like "360p", float drift, etc.)
            // to a clean INT for target_resolution. Always rounds to integer;
            // if snap_to_8 is on, additionally snaps to the nearest multiple
            // of 8.
            function coerceResTgt() {
                let v = resTgt.value;
                if (typeof v !== "number" || !Number.isFinite(v)) {
                    const m = String(v ?? "").match(/\d+(?:\.\d+)?/);
                    v = m ? parseFloat(m[0]) : 720;
                }
                v = Math.round(v); // always integer — kills any 303.0202 drift
                if (snapTo8W.value) {
                    v = Math.max(8, Math.round(v / 8) * 8);
                } else {
                    v = Math.max(1, v);
                }
                if (v !== resTgt.value) resTgt.value = v;
            }

            // Adjust the INT widget's arrow-step. ComfyUI's number widget
            // uses options.step (LiteGraph divides by 10 internally for the
            // actual increment). step=80 → +8 per arrow click. step2 covers
            // versions that read it directly.
            function applyResTgtStep() {
                if (!resTgt.options) return;
                const s = snapTo8W.value ? 8 : 1;
                resTgt.options.step  = s * 10; // LiteGraph divides by 10
                resTgt.options.step2 = s;       // some renderers use this directly
            }
            applyResTgtStep();
            coerceResTgt(); // normalize any existing (possibly loaded) bad value

            // Force the serialized value sent to Python to always be an int
            resTgt.serializeValue = async () => {
                coerceResTgt();
                return resTgt.value;
            };

            const origResPreCb = resPre.callback;
            resPre.callback = (value) => {
                origResPreCb?.call(node, value);
                // ComfyUI auto-copies preset strings ("360p") into adjacent INT widgets.
                // Reset resTgt to a sensible int whenever the preset changes.
                if (value in RESOLUTION_MAP) {
                    resTgt.value = RESOLUTION_MAP[value];
                } else {
                    coerceResTgt();
                }
                if (node._moboResExpanded) {
                    if (value === "Custom") showWidget(resTgt); else hideWidget(resTgt);
                    applyHeight();
                }
                updateSectionLabel();
                app.graph.setDirtyCanvas(true);
            };

            const origResTgtCb = resTgt.callback;
            resTgt.callback = (value) => {
                origResTgtCb?.call(node, value);
                coerceResTgt();          // force int + snap immediately on change
                updateSectionLabel();
                app.graph.setDirtyCanvas(true);
            };

            // Defensive: ComfyUI's INT widget can mutate `widget.value`
            // without calling `widget.callback` (some keyboard edit paths,
            // and the "Value" prompt dialog accepts floats). Watch on every
            // redraw, coerce to int + snap, and refresh the caption.
            const origResTgtDraw = resTgt.draw;
            let _lastResTgtSeen = resTgt.value;
            resTgt.draw = function (...args) {
                if (resTgt.value !== _lastResTgtSeen) {
                    coerceResTgt();
                    _lastResTgtSeen = resTgt.value;
                    updateSectionLabel();
                }
                return origResTgtDraw?.apply(this, args);
            };

            const origSnapCb = snapTo8W.callback;
            snapTo8W.callback = (value) => {
                origSnapCb?.call(node, value);
                applyResTgtStep();   // arrow-step: 8 when snap on, 1 when off
                // Re-snap the custom target_resolution so the field itself
                // matches the snapping rule the user just toggled.
                coerceResTgt();
                updateSectionLabel();
                app.graph.setDirtyCanvas(true);
            };

            if (longestSideW) {
                const origLongestCb = longestSideW.callback;
                longestSideW.callback = (value) => {
                    origLongestCb?.call(node, value);
                    updateSectionLabel();
                    app.graph.setDirtyCanvas(true);
                };
            }

            // --- Drag-and-drop -----------------------------------------------

            const origOnDragOver = node.onDragOver;
            node.onDragOver = (e) => {
                if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); return true; }
                return origOnDragOver?.call(node, e);
            };

            const origOnDragDrop = node.onDragDrop;
            node.onDragDrop = async (e) => {
                const files = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith("image/"));
                if (!files.length) return origOnDragDrop?.call(node, e) ?? false;
                await doUpload(files);
                return true;
            };


            // --- Subfolder / image widget callbacks --------------------------

            const origSubCb = subfolderWidget.callback;
            subfolderWidget.callback = async (value) => {
                origSubCb?.call(node, value);
                if (isModeSwitchLabel(value)) {
                    const mode = modeFromLabel(value);
                    if (mode && mode !== sourceType()) {
                        await switchSourceMode(mode);
                    } else {
                        // Same mode clicked — just reset to root of current base
                        const rootDisplay = Object.keys(pathsByDisplay).find(d => pathsByDisplay[d] === ".") || ".";
                        subfolderWidget.value = rootDisplay;
                        await refreshImages(rootDisplay);
                    }
                    return;
                }
                await refreshImages(value);
                // Re-fetch folder counts so the dropdown reflects any
                // additions/archival/deletion that happened since the node
                // was first loaded. The list is then re-rendered with fresh
                // "(N)" suffixes for the next time the user opens it.
                refreshSubfolders().catch(() => {});
            };

            // Refresh folder counts the moment the user clicks the subfolder
            // dropdown — that's the "I'm about to choose a folder" signal.
            // Fire-and-forget: if the network is fast the menu shows fresh
            // counts; otherwise the *next* click will. Either way, counts no
            // longer drift after add/upload/archive operations.
            {
                const origMouse = subfolderWidget.mouse;
                subfolderWidget.mouse = function (...args) {
                    refreshSubfolders().catch(() => {});
                    return origMouse?.apply(this, args);
                };
            }

            const origImgCb = imageWidget.callback;
            imageWidget.callback = (value) => {
                origImgCb?.call(node, value);
                probeImage(subfolderWidget.value, value);
                updateFileidDisplay();
                updateSubfolderId();
                updateResolvedOutputs();
            };

            // --- onConfigure (restore saved state) ---------------------------

            // --- Save widget values BY NAME (not just positionally) ---------
            // LiteGraph's default serialization is positional, which breaks across
            // versions whenever the widget count changes (e.g., we add a new widget).
            // We piggy-back on node.properties to stash a name-keyed backup and
            // restore from it in onConfigure — making saved workflows resilient to
            // future widget additions/reorderings.
            const MOBO_NAMED_WIDGETS = [
                "use_output_dir", "subfolder", "image",
                "aspect_ratio", "resolution_preset", "target_resolution", "snap_to_8",
                "longest_side",
                "subfolderid", "fileid",
                "outfile_template", "outfolder_template", "outfile", "outfolder",
            ];

            const origOnSerialize = node.onSerialize;
            node.onSerialize = function (o) {
                origOnSerialize?.apply(this, arguments);
                o.properties = o.properties || {};
                const named = {};
                for (const name of MOBO_NAMED_WIDGETS) {
                    const w = this.widgets.find(x => x.name === name);
                    if (w) named[name] = w.value;
                }
                o.properties.moboNamedValues = named;
            };

            const origOnConfigure = node.onConfigure;
            node.onConfigure = function (info) {
                // Mark so the initial-populate IIFE below knows to skip its
                // refreshImages() — otherwise the two race and the initial
                // path (which has no saved filename) can clobber our restore
                // with list[0].
                node._moboFromWorkflow = true;
                origOnConfigure?.call(node, info);
                // Name-based restore — overrides any positionally-scrambled values.
                // Safe for old workflows too (moboNamedValues just won't exist).
                if (info.properties?.moboNamedValues) {
                    for (const [name, value] of Object.entries(info.properties.moboNamedValues)) {
                        const w = this.widgets.find(x => x.name === name);
                        if (w && value !== undefined) w.value = value;
                    }
                }
                // Re-validate widget values after restore
                ensureValid(aspectW, "From input");
                ensureValid(resPre, "320p");
                if (typeof resTgt.value !== "number" || !Number.isFinite(resTgt.value)) {
                    resTgt.value = 320;
                }
                if (typeof snapTo8W.value !== "boolean") snapTo8W.value = true;

                if (info.properties?.showPreview === false) {
                    node._moboShowPreview = false;
                    previewToggle.value = false;
                }
                // Restore "After generate" mode. The widget was created with
                // node.properties empty (onConfigure runs after nodeCreated),
                // so without this it always starts as "fixed".
                if (info.properties?.controlAfterGenerate) {
                    controlW.value = info.properties.controlAfterGenerate;
                }
                // Restore source type (default: input)
                const savedSource = (info.properties?.sourceType === "output") ? "output" : "input";
                setSourceType(savedSource);

                // Saved subfolder may be: a mode-switch label, a plain path ("dogs"),
                // a stale display with old count ("dogs  (9)"), or empty.
                let savedSubfolder = subfolderWidget.value;
                if (isModeSwitchLabel(savedSubfolder) || !savedSubfolder) savedSubfolder = ".";
                const savedImage = imageWidget.value;

                (async () => {
                    try {
                        await refreshSubfolders();
                        // Migrate saved value to the current display string (with fresh count)
                        const targetReal = typeof savedSubfolder === "string" ? stripCount(savedSubfolder) : ".";
                        const targetDisplay = Object.keys(pathsByDisplay).find(d => pathsByDisplay[d] === targetReal);
                        if (targetDisplay) {
                            subfolderWidget.value = targetDisplay;
                        }
                        await refreshImages(subfolderWidget.value, savedImage);
                        if (info.properties?.resExpanded) setSectionExpanded(true);
                        if (info.properties?.outNameExpanded) setOutNameExpanded(true);
                    } catch (e) {
                        console.error("MoBo ImageLoaderPlus: onConfigure async failed", e);
                    }
                })();
            };

            // Initial populate for a freshly-added node (not loaded from workflow).
            // onConfigure is only called when loading — so without this, a brand-new
            // node would show plain folder names with no counts and empty fileid.
            //
            // When loading a saved workflow, ComfyUI calls onConfigure shortly
            // after nodeCreated. We wait one task tick so the flag set in
            // onConfigure is visible, and skip the initial refresh in that
            // case — otherwise this path would clobber the restored
            // subfolder/image with list[0] due to its own refreshImages().
            (async () => {
                await new Promise(r => setTimeout(r, 0));
                if (node._moboFromWorkflow) return;
                try {
                    await refreshSubfolders();
                    const root = Object.keys(pathsByDisplay).find(d => pathsByDisplay[d] === ".") || subfolderWidget.value;
                    if (root && !pathsByDisplay[subfolderWidget.value]) {
                        subfolderWidget.value = root;
                    }
                    await refreshImages(subfolderWidget.value);
                    updateFileidDisplay();
                    updateSubfolderId();
                    updateResolvedOutputs();
                } catch (e) { console.error("MoBo ImageLoaderPlus: initial populate failed", e); }
            })();
        };
    },
});
