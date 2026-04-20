/**
 * Shared "Show & Edit Image" popup editor.
 * Tools: Crop, Mask.
 * Imported by interactiveCrop.js and imageLoaderPlus.js.
 */

// ---------------------------------------------------------------------------
// Exported ratio helpers
// ---------------------------------------------------------------------------

export const STANDARD_RATIOS = {
    "1:1": 1, "4:3": 4/3, "3:4": 3/4, "5:4": 5/4, "4:5": 4/5,
    "3:2": 3/2, "2:3": 2/3, "16:9": 16/9, "9:16": 9/16,
    "16:10": 16/10, "10:16": 10/16, "21:9": 21/9, "9:21": 9/21,
    "2:1": 2, "1:2": 1/2,
};

export function findClosestStandardRatio(w, h) {
    if (h === 0) return { name: "1:1", value: 1 };
    const actual = w / h;
    let best = "1:1", bestDiff = Infinity;
    for (const [name, val] of Object.entries(STANDARD_RATIOS)) {
        const diff = Math.abs(actual - val);
        if (diff < bestDiff) { bestDiff = diff; best = name; }
    }
    return { name: best, value: STANDARD_RATIOS[best] };
}

export function fitCropToRatio(crop, ratio, imgW, imgH) {
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    let newW = crop.w, newH = newW / ratio;
    if (newH > crop.h) { newH = crop.h; newW = newH * ratio; }
    if (newW > imgW) { newW = imgW; newH = newW / ratio; }
    if (newH > imgH) { newH = imgH; newW = newH * ratio; }
    return {
        x: Math.max(0, Math.min(cx - newW / 2, imgW - newW)),
        y: Math.max(0, Math.min(cy - newH / 2, imgH - newH)),
        w: newW, h: newH,
    };
}

export function clampCrop(crop, imgW, imgH) {
    crop.x = Math.max(0, Math.min(crop.x, imgW - 1));
    crop.y = Math.max(0, Math.min(crop.y, imgH - 1));
    crop.w = Math.max(1, Math.min(crop.w, imgW - crop.x));
    crop.h = Math.max(1, Math.min(crop.h, imgH - crop.y));
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

function simplifyRatio(w, h) {
    w = Math.round(w); h = Math.round(h);
    const g = gcd(w, h);
    return `${w / g}x${h / g}`;
}

/** Strip any existing MoBo postfixes from a filename base. */
function stripPostfixes(base) {
    return base.replace(/(_copy|_cropped|_crop-[0-9]+x[0-9]+|_masked|_filled|_noised|_blurred|_r-?[0-9]+(?:\.[0-9]+)?|_flipH|_flipV)+$/, "");
}

function buildPostfix(crop, imgW, imgH, maskApplied, fillMode, transform) {
    transform = transform || { rotQuarters: 0, fineAngle: 0, flipH: false, flipV: false };
    const cropped = crop.x !== 0 || crop.y !== 0 ||
                    Math.round(crop.w) !== imgW || Math.round(crop.h) !== imgH;
    // Total rotation in degrees, normalized to -180..180
    let totalRot = (transform.rotQuarters || 0) * 90 + (transform.fineAngle || 0);
    totalRot = ((totalRot % 360) + 360) % 360;
    if (totalRot > 180) totalRot -= 360;
    const rotated = Math.abs(totalRot) > 0.05;
    const transformed = rotated || transform.flipH || transform.flipV;
    if (!cropped && !maskApplied && !transformed) return "_copy";
    let p = "";
    if (rotated) {
        const rounded = Math.abs(totalRot - Math.round(totalRot)) < 0.05 ? Math.round(totalRot) : totalRot;
        const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
        p += `_r${str}`;
    }
    if (transform.flipH) p += "_flipH";
    if (transform.flipV) p += "_flipV";
    if (cropped) {
        const ratioChanged = Math.abs(imgW / imgH - crop.w / crop.h) > 0.005;
        p += ratioChanged ? `_crop-${simplifyRatio(crop.w, crop.h)}` : "_cropped";
    }
    if (maskApplied) {
        if (fillMode === "noise") p += "_noised";
        else if (fillMode.startsWith("blur")) p += "_blurred";
        else if (fillMode === "color") p += "_filled";
        else p += "_masked";
    }
    return p;
}

function mkBtn(text, bg, fg = "#fff") {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText = `padding:6px 12px;border:none;border-radius:5px;cursor:pointer;
        font-size:13px;background:${bg};color:${fg};white-space:nowrap;`;
    return b;
}

function drawCheckerboard(ctx, w, h, size = 10) {
    for (let y = 0; y < h; y += size) {
        for (let x = 0; x < w; x += size) {
            ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? "#bbb" : "#888";
            ctx.fillRect(x, y, Math.min(size, w - x), Math.min(size, h - y));
        }
    }
}

// Upload helper — returns true on success.
async function uploadCanvas(canvas, filename, subfolder, btn, onSaved) {
    if (!filename) filename = `image_${Date.now()}.png`;
    const dot = filename.lastIndexOf(".");
    let ext = dot > 0 ? filename.substring(dot + 1).toLowerCase() : "png";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) ext = "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
               : ext === "webp" ? "image/webp" : "image/png";
    const quality = mime === "image/jpeg" ? 0.99 : undefined;
    const orig = btn.textContent;
    btn.textContent = "⏳ Saving…";
    try {
        const blob = await new Promise(r => canvas.toBlob(r, mime, quality));
        const fd = new FormData();
        fd.append("image", new File([blob], filename, { type: mime }));
        fd.append("subfolder", subfolder || "");
        fd.append("type", "input");
        fd.append("overwrite", "true");
        const resp = await fetch("/upload/image", { method: "POST", body: fd });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const result = await resp.json();
        btn.textContent = `✅ ${result.name}`;
        onSaved?.(result.name);
        return true;
    } catch (err) {
        console.error("Save failed:", err);
        btn.textContent = "❌ Failed";
        setTimeout(() => { btn.textContent = orig; }, 3000);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export function openCropEditor(imgUrl, xWidget, yWidget, wWidget, hWidget, node,
                                sourceFilename, sourceSubfolder, onSaved) {

    const hasCropWidgets = !!(xWidget && yWidget && wWidget && hWidget);

    // ---- Overlay shell (shown immediately) ---------------------------------
    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100vw;height:100vh;
        background:rgba(0,0,0,0.9);z-index:100000;
        display:flex;flex-direction:column;align-items:center;
        padding:10px 0 0 0;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        color:#fff;user-select:none;overflow:hidden;
    `;
    document.body.appendChild(overlay);

    const loadingDiv = document.createElement("div");
    loadingDiv.textContent = "Loading image…";
    loadingDiv.style.cssText = "font-size:18px;color:#aaa;";
    overlay.appendChild(loadingDiv);

    const earlyEsc = (e) => { if (e.key === "Escape") earlyCleanup(); };
    const earlyCleanup = () => {
        document.removeEventListener("keydown", earlyEsc);
        overlay.remove();
    };
    document.addEventListener("keydown", earlyEsc);

    // ---- Image load --------------------------------------------------------
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onerror = () => {
        earlyCleanup();
        alert("Failed to load the source image.");
    };

    img.onload = () => {
      try {
        document.removeEventListener("keydown", earlyEsc);
        overlay.innerHTML = "";

        const origW = img.naturalWidth;
        const origH = img.naturalHeight;

        // Viewport dimensions — responsive to the window. Canvas is sized to
        // these; they are recomputed on window resize so the editor is always
        // usable even after the user shrinks the browser window.
        const UI_WIDTH_FRAC  = 0.40;   // canvas width = 40% of window
        const UI_HEIGHT_FRAC = 0.85;   // canvas height fraction of viewport-available
        const TOP_ROWS_PX    = 100;    // approx height of row1 + row2
        const BOTTOM_ROW_PX  = 56;     // xformRow

        function computeViewport() {
            return {
                w: Math.max(320, Math.floor(window.innerWidth  * UI_WIDTH_FRAC)),
                h: Math.max(260, Math.floor((window.innerHeight - TOP_ROWS_PX - BOTTOM_ROW_PX - 40) * UI_HEIGHT_FRAC)),
            };
        }
        let { w: dispW, h: dispH } = computeViewport();

        // Source dimensions (change with transform). These are the coordinate
        // system used by crop/mask/save.
        let imgW = origW, imgH = origH;

        // Fit parameters: how srcCanvas maps into the viewport.
        let scale = 1, offsetX = 0, offsetY = 0;

        // Source canvas: img after rotation + flip applied. All crop/mask/save read from this.
        let srcCanvas = document.createElement("canvas");
        let srcCtx    = srcCanvas.getContext("2d");

        // Transform state
        let rotQuarters = 0;   // 0, 1, 2, 3 representing 0°, 90°, 180°, 270° CW
        let fineAngle   = 0;   // Freehand rotation in degrees, typically -45..+45
        let flipHoriz   = false;
        let flipVert    = false;

        // srcCanvas = base image with ONLY 90°/flip applied. Fine rotation is
        // applied at draw/save time, around the crop-rect's center. This lets
        // the rotation pivot follow the user's crop position correctly.
        function rebuildSource() {
            const coarsePortrait = rotQuarters % 2 !== 0;
            const baseW = coarsePortrait ? origH : origW;
            const baseH = coarsePortrait ? origW : origH;
            imgW = baseW; imgH = baseH;

            srcCanvas.width  = imgW;
            srcCanvas.height = imgH;
            srcCtx.save();
            srcCtx.clearRect(0, 0, imgW, imgH);
            srcCtx.translate(imgW / 2, imgH / 2);
            srcCtx.rotate(rotQuarters * Math.PI / 2);
            srcCtx.scale(flipHoriz ? -1 : 1, flipVert ? -1 : 1);
            srcCtx.drawImage(img, -origW / 2, -origH / 2);
            srcCtx.restore();
        }
        rebuildSource();

        // Stubs kept so call sites don't break; in the new draw-time-rotation
        // model these are no-ops (layout is purely fit-to-viewport).
        function computeTargetCropView() { /* no-op */ }

        // Layout model:
        //  - Crop center is always positioned at the viewport center (on layout recompute).
        //  - Scale is chosen so the crop rect fills the viewport (minus a margin).
        //  - Image may extend beyond the viewport — that's intended.
        //  - Rotation pivot is the viewport center (which coincides with crop center).
        //
        // Call recomputeLayout() after the crop SIZE/POSITION changes (drag-end or
        // aspect change) to re-center and re-zoom. Not called on fine rotation.
        const LAYOUT_MARGIN = 0.88;

        function computeLayoutFor(cropRect) {
            const w = Math.max(cropRect.w, 1), h = Math.max(cropRect.h, 1);
            const s = Math.min((dispW * LAYOUT_MARGIN) / w, (dispH * LAYOUT_MARGIN) / h);
            const cx = cropRect.x + cropRect.w / 2;
            const cy = cropRect.y + cropRect.h / 2;
            return {
                scale: s,
                offsetX: Math.round(dispW / 2 - cx * s),
                offsetY: Math.round(dispH / 2 - cy * s),
            };
        }

        function recomputeLayout(preserveCrop = true) {
            if (!preserveCrop || !crop || crop.w <= 0) {
                crop = { x: 0, y: 0, w: imgW, h: imgH };
                if (lockedRatio !== null) crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
            }
            clampCrop(crop, imgW, imgH);
            const L = computeLayoutFor(crop);
            scale = L.scale; offsetX = L.offsetX; offsetY = L.offsetY;
        }

        // Smooth animated transition to a new (scale, offsetX, offsetY).
        let _animRaf = null;
        function animateLayoutTo(targetScale, targetOX, targetOY, duration = 220) {
            if (_animRaf) cancelAnimationFrame(_animRaf);
            const startScale = scale, startOX = offsetX, startOY = offsetY;
            // If already close, just snap
            if (Math.abs(targetScale - startScale) < 1e-3 &&
                Math.abs(targetOX - startOX) < 1 &&
                Math.abs(targetOY - startOY) < 1) {
                scale = targetScale; offsetX = targetOX; offsetY = targetOY;
                draw();
                return;
            }
            const t0 = performance.now();
            function tick(now) {
                const t = Math.min(1, (now - t0) / duration);
                const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
                scale   = startScale + (targetScale - startScale) * e;
                offsetX = startOX    + (targetOX    - startOX)    * e;
                offsetY = startOY    + (targetOY    - startOY)    * e;
                draw();
                if (t < 1) _animRaf = requestAnimationFrame(tick);
                else _animRaf = null;
            }
            _animRaf = requestAnimationFrame(tick);
        }

        function reLayoutAnimated() {
            const L = computeLayoutFor(crop);
            animateLayoutTo(L.scale, L.offsetX, L.offsetY);
        }

        // ---- Filename helpers --------------------------------------------
        const srcDot  = sourceFilename ? sourceFilename.lastIndexOf(".") : -1;
        const srcBaseRaw = sourceFilename
            ? (srcDot > 0 ? sourceFilename.substring(0, srcDot) : sourceFilename)
            : "image";
        const srcBase = stripPostfixes(srcBaseRaw);
        const srcExt = (() => {
            if (srcDot <= 0 || !sourceFilename) return "png";
            const e = sourceFilename.substring(srcDot + 1).toLowerCase();
            return ["png", "webp"].includes(e) ? e : "png";
        })();

        // ---- State -------------------------------------------------------
        const imageRatio      = findClosestStandardRatio(imgW, imgH);
        const imageExactRatio = imgW / imgH;

        let lockedRatio     = imageExactRatio;
        let activeRatioName = "Image";
        let crop = { x: 0, y: 0, w: imgW, h: imgH };
        // Compute initial target crop view size + layout (scale, offsets, crop).
        // The Interactive Crop node passes pre-existing widget values; if they
        // look like the "uninitialized 512" default we use the full image.
        // (At init fineAngle = 0 → constrain vs. unconstrained agree: full image.)
        computeTargetCropView();
        recomputeLayout();
        // Note: constrain default is true — rotation has to happen before the
        // rule does anything different; applyConstraint() at angle 0 = full image.
        // If widgets had custom values, apply them (only meaningful at θ=0 flip=false)
        if (xWidget && (xWidget.value || 0) > 0 || yWidget && (yWidget.value || 0) > 0) {
            const wx = xWidget?.value || 0;
            const wy = yWidget?.value || 0;
            const ww = wWidget?.value || imgW;
            const wh = hWidget?.value || imgH;
            if (!(ww === 512 && wh === 512 && imgW !== 512)) {
                crop = { x: wx, y: wy, w: ww, h: wh };
                if (lockedRatio !== null) crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
                clampCrop(crop, imgW, imgH);
            }
        }

        let dragMode = null, dragStart = null, dragCropStart = null;
        const HANDLE = 8;

        // Mask state
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = imgW; maskCanvas.height = imgH;
        const maskCtx = maskCanvas.getContext("2d");

        const maskOverlay = document.createElement("canvas");
        maskOverlay.width = imgW; maskOverlay.height = imgH;
        const maskOverlayCtx = maskOverlay.getContext("2d");

        let maskMode    = "add";
        let maskDirty   = false;
        let maskApplied = false;
        let maskFillMode = "transparent"; // transparent | color | noise | blur-*
        let fillColor   = "#000000";
        let workingCanvas = null;
        let brushSize   = 30;
        let mousePos    = null;
        let painting    = false;
        let eyedropperActive = false;

        // Mask undo/redo history
        const maskHistory = [];
        const maskRedoStack = [];
        const MAX_HISTORY = 30;

        function pushMaskHistory() {
            maskHistory.push(maskCtx.getImageData(0, 0, imgW, imgH));
            if (maskHistory.length > MAX_HISTORY) maskHistory.shift();
            maskRedoStack.length = 0; // clear redo on new action
        }

        function undoMask() {
            if (maskHistory.length === 0) return;
            maskRedoStack.push(maskCtx.getImageData(0, 0, imgW, imgH));
            maskCtx.putImageData(maskHistory.pop(), 0, 0);
            maskDirty = maskHistory.length > 0 || hasAnyMaskPixels();
            refreshMaskOverlay();
            draw();
        }

        function redoMask() {
            if (maskRedoStack.length === 0) return;
            maskHistory.push(maskCtx.getImageData(0, 0, imgW, imgH));
            maskCtx.putImageData(maskRedoStack.pop(), 0, 0);
            maskDirty = true;
            refreshMaskOverlay();
            draw();
        }

        function hasAnyMaskPixels() {
            const d = maskCtx.getImageData(0, 0, imgW, imgH).data;
            for (let i = 0; i < d.length; i += 4) { if (d[i] > 0) return true; }
            return false;
        }

        // Tool state
        let activeTool = "crop";

        // Save name tracking
        function defaultSaveName() {
            const tfm = { rotQuarters, fineAngle, flipH: flipHoriz, flipV: flipVert };
            return `${srcBase}${buildPostfix(crop, imgW, imgH, maskApplied, maskFillMode, tfm)}.${srcExt}`;
        }
        let autoSaveName = defaultSaveName();

        function defaultMaskName() { return `${srcBase}_mask.png`; }

        // ---- Build UI ----------------------------------------------------

        // Row 1: tool selector + global controls
        const row1 = document.createElement("div");
        row1.style.cssText = `
            display:flex;align-items:center;gap:8px;padding:8px 14px;
            background:#1a1a2e;border-radius:8px 8px 0 0;
            width:${dispW}px;box-sizing:border-box;flex-wrap:wrap;
        `;
        overlay.appendChild(row1);

        const cropToolBtn = mkBtn("✂️ Crop", "#4a9eff");
        const maskToolBtn = mkBtn("🎭 Mask", "#3a3a4e", "#aaa");
        row1.appendChild(cropToolBtn);
        row1.appendChild(maskToolBtn);

        const sep1 = document.createElement("div");
        sep1.style.cssText = "width:1px;height:20px;background:#444;margin:0 2px;";
        row1.appendChild(sep1);

        const saveNameInput = document.createElement("input");
        saveNameInput.type = "text";
        saveNameInput.style.cssText = `
            padding:5px 9px;background:#2a2a3e;color:#fff;border:1px solid #555;
            border-radius:5px;font-size:13px;flex:1;min-width:120px;outline:none;
        `;
        saveNameInput.value = autoSaveName;
        row1.appendChild(saveNameInput);

        // Save buttons stacked vertically — main Save on top, Save Mask below (mask mode only)
        const saveStack = document.createElement("div");
        saveStack.style.cssText = "display:flex;flex-direction:column;gap:4px;";
        const saveBtn = mkBtn("💾 Save", "#2d6b3f");
        const saveMaskBtn = mkBtn("💾 Mask", "#2d6b3f");
        saveMaskBtn.title = "Save painted mask as a separate grayscale PNG";
        saveStack.appendChild(saveBtn);
        saveStack.appendChild(saveMaskBtn);
        row1.appendChild(saveStack);

        // Unified Reset — adapts to active tool (resets crop in crop mode, mask in mask mode)
        const resetBtn = mkBtn("Reset", "#3a3a4e", "#aaa");
        resetBtn.title = "Reset current tool  (R)";
        row1.appendChild(resetBtn);

        const applyBtn = mkBtn("Apply", "#4a9eff");
        if (!hasCropWidgets) applyBtn.style.display = "none";
        row1.appendChild(applyBtn);

        const cancelBtn = mkBtn("✕", "#555", "#fff");
        cancelBtn.title = "Close  (Esc)";
        row1.appendChild(cancelBtn);

        // Row 2: tool-specific controls
        const row2 = document.createElement("div");
        row2.style.cssText = `
            display:flex;align-items:center;gap:6px;padding:5px 14px;
            background:#131326;
            width:${dispW}px;box-sizing:border-box;flex-wrap:wrap;min-height:34px;
        `;
        overlay.appendChild(row2);

        // ---- Crop controls (ratio bar) -----------------------------------
        const ratioBar = document.createElement("div");
        ratioBar.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;align-items:center;";
        row2.appendChild(ratioBar);

        const ratioButtons = {};
        function makeRatioBtn(label, ratioValue, ratioName) {
            const b = document.createElement("button");
            b.textContent = label;
            b.style.cssText = "padding:4px 9px;border:1px solid #444;border-radius:4px;" +
                              "background:#2a2a3e;color:#aaa;cursor:pointer;font-size:11px;";
            b.onclick = () => {
                activeRatioName = ratioName;
                lockedRatio = ratioValue;
                updateRatioBtns();
                // Re-fit the current crop to the new ratio. In constrain mode
                // we use the inscribed rect for the new aspect. Otherwise
                // just fit-to-ratio centered on current crop center.
                if (constrainToImage && lockedRatio !== null) {
                    applyConstraint();
                } else if (lockedRatio !== null) {
                    crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
                    clampCrop(crop, imgW, imgH);
                }
                // Animate scale/offsets so the new crop fills the viewport again.
                reLayoutAnimated();
            };
            ratioBar.appendChild(b);
            ratioButtons[ratioName] = b;
        }

        makeRatioBtn("Free", null, "Free");
        makeRatioBtn(`Image (${imageRatio.name})`, imageExactRatio, "Image");
        const rSep = document.createElement("span");
        rSep.style.cssText = "color:#444;"; rSep.textContent = "|";
        ratioBar.appendChild(rSep);
        for (const [name, val] of Object.entries(STANDARD_RATIOS)) makeRatioBtn(name, val, name);

        function updateRatioBtns() {
            for (const [name, b] of Object.entries(ratioButtons)) {
                const on = name === activeRatioName;
                b.style.background  = on ? "#4a9eff" : "#2a2a3e";
                b.style.color       = on ? "#fff"    : "#aaa";
                b.style.borderColor = on ? "#4a9eff" : "#444";
            }
        }
        updateRatioBtns();

        // ---- Mask controls -----------------------------------------------
        const maskRow = document.createElement("div");
        maskRow.style.cssText = "display:none;align-items:center;gap:8px;flex-wrap:wrap;";
        row2.appendChild(maskRow);

        // Brush size
        const bLabel = document.createElement("span");
        bLabel.style.cssText = "font-size:12px;color:#aaa;"; bLabel.textContent = "Brush:";
        maskRow.appendChild(bLabel);
        const brushSlider = document.createElement("input");
        brushSlider.type = "range"; brushSlider.min = "4"; brushSlider.max = "200";
        brushSlider.value = String(brushSize);
        brushSlider.style.cssText = "width:100px;accent-color:#4a9eff;cursor:pointer;";
        maskRow.appendChild(brushSlider);
        const bSzLabel = document.createElement("span");
        bSzLabel.style.cssText = "font-size:12px;color:#aaa;min-width:30px;";
        bSzLabel.textContent = String(brushSize);
        maskRow.appendChild(bSzLabel);
        brushSlider.oninput = () => { brushSize = parseInt(brushSlider.value); bSzLabel.textContent = String(brushSize); draw(); };

        const msep1 = document.createElement("div");
        msep1.style.cssText = "width:1px;height:20px;background:#444;";
        maskRow.appendChild(msep1);

        // Add / Remove mode
        const addModeBtn    = mkBtn("➕ Add",    "#4a9eff");
        const removeModeBtn = mkBtn("➖ Remove", "#3a3a4e", "#aaa");
        maskRow.appendChild(addModeBtn);
        maskRow.appendChild(removeModeBtn);

        const msep2 = document.createElement("div");
        msep2.style.cssText = "width:1px;height:20px;background:#444;";
        maskRow.appendChild(msep2);

        // Fill mode
        const fillLabel = document.createElement("span");
        fillLabel.style.cssText = "font-size:12px;color:#aaa;"; fillLabel.textContent = "Fill:";
        maskRow.appendChild(fillLabel);
        const fillSelect = document.createElement("select");
        fillSelect.style.cssText = "padding:4px 6px;background:#2a2a3e;color:#fff;border:1px solid #555;border-radius:4px;font-size:12px;cursor:pointer;";
        for (const [val, label] of [["transparent","Transparent"],["color","Color"],["noise","Noise"],["blur-light","Blur (light)"],["blur-medium","Blur (medium)"],["blur-heavy","Blur (heavy)"]]) {
            const o = document.createElement("option");
            o.value = val; o.textContent = label;
            fillSelect.appendChild(o);
        }
        fillSelect.value = maskFillMode;
        maskRow.appendChild(fillSelect);

        // Color picker (visible when fill=color)
        const colorInput = document.createElement("input");
        colorInput.type = "color"; colorInput.value = fillColor;
        colorInput.style.cssText = "width:32px;height:26px;border:1px solid #555;border-radius:4px;cursor:pointer;background:none;padding:0;display:none;";
        maskRow.appendChild(colorInput);

        // Eyedropper button
        const eyedropperBtn = mkBtn("💧", "#3a3a4e", "#aaa");
        eyedropperBtn.title = "Pick color from image";
        eyedropperBtn.style.display = "none";
        maskRow.appendChild(eyedropperBtn);

        fillSelect.onchange = () => {
            maskFillMode = fillSelect.value;
            colorInput.style.display = maskFillMode === "color" ? "" : "none";
            eyedropperBtn.style.display = maskFillMode === "color" ? "" : "none";
        };
        colorInput.oninput = () => { fillColor = colorInput.value; };
        eyedropperBtn.onclick = () => {
            eyedropperActive = !eyedropperActive;
            eyedropperBtn.style.background = eyedropperActive ? "#4a9eff" : "#3a3a4e";
            eyedropperBtn.style.color = eyedropperActive ? "#fff" : "#aaa";
            if (eyedropperActive) canvas.style.cursor = "crosshair";
        };

        const msep3 = document.createElement("div");
        msep3.style.cssText = "width:1px;height:20px;background:#444;";
        maskRow.appendChild(msep3);

        // Undo / Redo
        const undoBtn = mkBtn("↩", "#3a3a4e", "#aaa");
        undoBtn.title = "Undo  (Ctrl+Z)";
        maskRow.appendChild(undoBtn);
        const redoBtn = mkBtn("↪", "#3a3a4e", "#aaa");
        redoBtn.title = "Redo  (Ctrl+Y)";
        maskRow.appendChild(redoBtn);

        const msep3b = document.createElement("div");
        msep3b.style.cssText = "width:1px;height:20px;background:#444;";
        maskRow.appendChild(msep3b);

        // Apply Mask (Reset handled by unified Reset button in row1)
        const applyMaskBtn = mkBtn("Apply Mask", "#7b2d2d");
        maskRow.appendChild(applyMaskBtn);

        const msep4 = document.createElement("div");
        msep4.style.cssText = "width:1px;height:20px;background:#444;";
        maskRow.appendChild(msep4);

        // Mask filename input (the Save Mask button lives in row1)
        const maskNameInput = document.createElement("input");
        maskNameInput.type = "text";
        maskNameInput.style.cssText = `padding:5px 9px;background:#2a2a3e;color:#fff;border:1px solid #555;
            border-radius:5px;font-size:13px;width:180px;outline:none;`;
        maskNameInput.placeholder = "mask filename";
        maskRow.appendChild(maskNameInput);

        // ---- Canvas ------------------------------------------------------
        // Wrap canvas in a flex:1 wrapper so it fills the space between the top
        // rows and the xformRow (pinned to bottom). UI stays stable on transform.
        const canvasWrapper = document.createElement("div");
        canvasWrapper.style.cssText = `
            flex:1 1 auto;display:flex;align-items:center;justify-content:center;
            min-height:0;width:100%;overflow:hidden;
        `;
        const canvas = document.createElement("canvas");
        canvas.width = dispW; canvas.height = dispH;
        canvas.style.cssText = "cursor:crosshair;display:block;";
        canvasWrapper.appendChild(canvas);
        overlay.appendChild(canvasWrapper);
        const ctx = canvas.getContext("2d");

        // ---- Transform strip (below canvas, crop mode only) --------------
        const xformRow = document.createElement("div");
        xformRow.style.cssText = `
            display:flex;align-items:center;gap:8px;padding:6px 14px;
            background:#131326;border-radius:0 0 8px 8px;
            width:${dispW}px;box-sizing:border-box;flex-wrap:wrap;min-height:36px;
        `;
        overlay.appendChild(xformRow);

        const rotCWBtn    = mkBtn("⟳ 90°", "#3a3a4e", "#ddd");
        rotCWBtn.title    = "Rotate 90° clockwise";
        const flipHBtn    = mkBtn("↔", "#3a3a4e", "#ddd");
        flipHBtn.title    = "Flip horizontally";
        const flipVBtn    = mkBtn("↕", "#3a3a4e", "#ddd");
        flipVBtn.title    = "Flip vertically";
        const xformLabel  = document.createElement("span");
        xformLabel.style.cssText = "font-size:12px;color:#777;flex:1;";
        xformLabel.textContent = "Transform:";

        xformRow.appendChild(xformLabel);
        // The placeholder flex:1 label is first — buttons go on the right.
        // Better: put buttons first, label pushes toward right edge… or separator.
        // Rebuild for clarity:
        // Freehand rotation slider + degree label
        const angleSlider = document.createElement("input");
        angleSlider.type = "range";
        angleSlider.min = "-45";
        angleSlider.max = "45";
        angleSlider.step = "0.1";
        angleSlider.value = "0";
        angleSlider.style.cssText = "flex:1;min-width:120px;accent-color:#4a9eff;cursor:pointer;";

        const angleLabel = document.createElement("span");
        angleLabel.style.cssText = "font-size:12px;color:#ccc;font-family:monospace;min-width:44px;text-align:right;";
        angleLabel.textContent = "0°";

        const sep2 = document.createElement("div");
        sep2.style.cssText = "width:1px;height:20px;background:#444;margin:0 4px;";

        // "Constrain to image" — when ON, the crop is auto-locked to the
        // largest rect of the current aspect ratio that fits inside the
        // rotated image (centered). Rotating shrinks/regrows the crop so
        // no empty corners ever appear. Pan/resize are restricted in this
        // mode. When OFF (default), rotation pivots around the crop center
        // and the image can swing past its own edges.
        let constrainToImage = true;   // DEFAULT ON
        const constrainLabel = document.createElement("label");
        constrainLabel.style.cssText = "font-size:11px;color:#999;cursor:pointer;display:flex;align-items:center;gap:4px;margin-left:6px;";
        const constrainCheckbox = document.createElement("input");
        constrainCheckbox.type = "checkbox";
        constrainCheckbox.checked = true;   // DEFAULT ON
        constrainCheckbox.style.cssText = "accent-color:#4a9eff;cursor:pointer;";
        constrainCheckbox.title = "ON (default): crop is clamped to stay fully inside the rotated image. Rotating shrinks the crop.\nOFF: crop can extend beyond the image — padding (transparent/color/noise) fills the outside on save. Rotating grows the crop to the bounding box of the rotated image.";
        constrainLabel.appendChild(constrainCheckbox);
        const constrainText = document.createElement("span");
        constrainText.textContent = "Constrain to image";
        constrainLabel.appendChild(constrainText);

        // Padding mode (used when crop extends past image boundaries — e.g. after
        // rotating with Constrain OFF, or zooming out past the image edge).
        const padLabel = document.createElement("span");
        padLabel.style.cssText = "font-size:11px;color:#999;margin-left:6px;";
        padLabel.textContent = "Pad:";
        const padSelect = document.createElement("select");
        padSelect.style.cssText = "padding:3px 5px;background:#2a2a3e;color:#fff;border:1px solid #555;border-radius:4px;font-size:11px;cursor:pointer;";
        for (const [val, lab] of [["transparent","Transparent"],["color","Color"],["noise","Noise"]]) {
            const o = document.createElement("option");
            o.value = val; o.textContent = lab; padSelect.appendChild(o);
        }
        let padMode = "transparent";
        padSelect.value = padMode;
        const padColorInput = document.createElement("input");
        padColorInput.type = "color"; padColorInput.value = "#000000";
        padColorInput.style.cssText = "width:24px;height:20px;border:1px solid #555;border-radius:3px;cursor:pointer;background:none;padding:0;display:none;";
        padSelect.onchange = () => {
            padMode = padSelect.value;
            padColorInput.style.display = padMode === "color" ? "" : "none";
        };

        // Output resolution mode (applied on save):
        //   match    → downscale so output's short side == source short side
        //              (no upscaling; 1:1 if crop ≤ source).
        //   native   → crop.w × crop.h in source pixels (maximum quality,
        //              output grows with rotation/padding).
        //   balanced → geometric mean between the two above.
        const resLabel = document.createElement("span");
        resLabel.style.cssText = "font-size:11px;color:#999;margin-left:6px;";
        resLabel.textContent = "Res:";
        const resSelect = document.createElement("select");
        resSelect.style.cssText = "padding:3px 5px;background:#2a2a3e;color:#fff;border:1px solid #555;border-radius:4px;font-size:11px;cursor:pointer;";
        for (const [val, lab] of [
            ["match",    "Match source"],
            ["balanced", "Balanced"],
            ["native",   "Native (max)"],
        ]) {
            const o = document.createElement("option");
            o.value = val; o.textContent = lab; resSelect.appendChild(o);
        }
        let resMode = "balanced";
        resSelect.value = resMode;
        resSelect.title = "Output resolution on save:\n  Match source: downscale so short side matches the source short side (no upscale).\n  Balanced: geometric mean between Match and Native — preserves some detail lost to rotation without blowing up file size.\n  Native (max): crop.w × crop.h in source pixels; highest quality, largest file, grows with rotation/padding.";
        resSelect.onchange = () => { resMode = resSelect.value; };

        xformRow.innerHTML = "";
        xformRow.appendChild(rotCWBtn);
        xformRow.appendChild(flipHBtn);
        xformRow.appendChild(flipVBtn);
        xformRow.appendChild(sep2);
        xformRow.appendChild(angleSlider);
        xformRow.appendChild(angleLabel);
        xformRow.appendChild(constrainLabel);
        xformRow.appendChild(padLabel);
        xformRow.appendChild(padSelect);
        xformRow.appendChild(padColorInput);
        xformRow.appendChild(resLabel);
        xformRow.appendChild(resSelect);

        // Apply the "constrain to image" rule: shrink crop to largest rect of
        // current aspect ratio that fits inside the image rotated by fineAngle,
        // centered on the image.
        function applyConstraint() {
            const aspect = lockedRatio !== null ? lockedRatio : (crop.w / Math.max(crop.h, 1));
            const { w, h } = computeInscribedRect(imgW, imgH, fineAngle, aspect);
            crop = {
                x: (imgW - w) / 2,
                y: (imgH - h) / 2,
                w, h,
            };
            clampCrop(crop, imgW, imgH);
        }

        // Outer bounding box of the image rotated by fineAngle, centered on the
        // image. Used when Constrain is OFF so rotating grows the crop to
        // include the entire rotated image (with padding at the corners).
        function applyBoundingBox() {
            const theta = fineAngle * Math.PI / 180;
            const c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
            let bbw = imgW * c + imgH * s;
            let bbh = imgW * s + imgH * c;
            // If an aspect ratio is locked, grow to the smallest rect of that
            // ratio that contains the rotated-image bbox (so entire image fits).
            if (lockedRatio !== null) {
                const r = lockedRatio;
                if (bbw / bbh > r) bbh = bbw / r;
                else bbw = bbh * r;
            }
            crop = {
                x: (imgW - bbw) / 2,
                y: (imgH - bbh) / 2,
                w: bbw, h: bbh,
            };
            // NOTE: NOT clamped to image — crop may extend outside, that's the padding.
        }

        // Clamp crop so the ROTATED (by fineAngle, around its own center) crop
        // stays inside the image. Preserves aspect where possible. Used during
        // pan/resize when constrainToImage is ON.
        function clampCropConstrained() {
            const theta = fineAngle * Math.PI / 180;
            const c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
            // 1) Clamp size to inscribed-rect max for current angle + aspect
            const aspect = lockedRatio !== null ? lockedRatio : (crop.w / Math.max(crop.h, 1));
            const maxRect = computeInscribedRect(imgW, imgH, fineAngle, aspect);
            if (crop.w > maxRect.w) {
                crop.w = maxRect.w;
                if (lockedRatio !== null) crop.h = crop.w / lockedRatio;
            }
            if (crop.h > maxRect.h) {
                crop.h = maxRect.h;
                if (lockedRatio !== null) crop.w = crop.h * lockedRatio;
            }
            // 2) Clamp center so the rotated-crop bbox fits in [0..imgW]×[0..imgH]
            const bhw = (crop.w / 2) * c + (crop.h / 2) * s;
            const bhh = (crop.w / 2) * s + (crop.h / 2) * c;
            const cx = crop.x + crop.w / 2;
            const cy = crop.y + crop.h / 2;
            const clCx = Math.max(bhw, Math.min(cx, imgW - bhw));
            const clCy = Math.max(bhh, Math.min(cy, imgH - bhh));
            crop.x = clCx - crop.w / 2;
            crop.y = clCy - crop.h / 2;
        }

        constrainCheckbox.onchange = () => {
            constrainToImage = constrainCheckbox.checked;
            if (constrainToImage) applyConstraint();
            else                  applyBoundingBox();
            reLayoutAnimated();
        };

        // After a transform changes the source, reset mask and recompute layout.
        function afterTransformChange(preserveCrop = false) {
            maskCanvas.width  = imgW; maskCanvas.height = imgH;
            maskCtx.clearRect(0, 0, imgW, imgH);
            maskOverlay.width  = imgW; maskOverlay.height = imgH;
            maskOverlayCtx.clearRect(0, 0, imgW, imgH);
            maskDirty = false;
            maskApplied = false;
            workingCanvas = null;
            maskHistory.length = 0;
            maskRedoStack.length = 0;

            // Reshape crop for the (new) source dims + current rotation
            if (constrainToImage) applyConstraint();
            else                  applyBoundingBox();
            const L = computeLayoutFor(crop);
            scale = L.scale; offsetX = L.offsetX; offsetY = L.offsetY;
            draw();
        }

        // Largest axis-aligned rect of given aspect ratio that fits inside a
        // `contentW × contentH` rectangle rotated by `angleDeg`, centered.
        function computeInscribedRect(contentW, contentH, angleDeg, aspect) {
            const theta = Math.abs(angleDeg * Math.PI / 180);
            const c = Math.abs(Math.cos(theta));
            const s = Math.abs(Math.sin(theta));
            const denom1 = aspect * c + s;
            const denom2 = aspect * s + c;
            const h1 = denom1 > 0 ? contentW / denom1 : Infinity;
            const h2 = denom2 > 0 ? contentH / denom2 : Infinity;
            const h = Math.min(h1, h2);
            const w = aspect * h;
            return { w, h };
        }

        function fitCropToTransform() {
            const coarsePortrait = rotQuarters % 2 !== 0;
            const baseW = coarsePortrait ? origH : origW;
            const baseH = coarsePortrait ? origW : origH;
            const aspect = lockedRatio !== null ? lockedRatio : (baseW / baseH);

            if (Math.abs(fineAngle) > 0.05) {
                const { w, h } = computeInscribedRect(baseW, baseH, fineAngle, aspect);
                crop = {
                    x: (imgW - w) / 2,
                    y: (imgH - h) / 2,
                    w, h,
                };
            } else {
                // No fine rotation — full source content fits within the bbox
                crop = { x: 0, y: 0, w: imgW, h: imgH };
                if (lockedRatio !== null) crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
            }
            clampCrop(crop, imgW, imgH);
        }

        function rotate90CW() {
            rotQuarters = (rotQuarters + 1) % 4;
            // Swap locked ratio (16:9 → 9:16) since source dims swap
            if (lockedRatio !== null && lockedRatio !== 1) {
                lockedRatio = 1 / lockedRatio;
                // Find a matching ratio button to update active highlight
                let found = null;
                for (const [name, val] of Object.entries(STANDARD_RATIOS)) {
                    if (Math.abs(val - lockedRatio) < 0.001) { found = name; break; }
                }
                activeRatioName = found || activeRatioName;
                // 'Image' is a special ratio that's the original image's ratio — keep it inverted too
                if (activeRatioName === "Image") {
                    // imageExactRatio was based on origW/origH and should invert too
                    // but imageExactRatio is const — we just leave activeRatioName as 'Image'
                    // and lockedRatio as the new inverted value
                }
                updateRatioBtns();
            }
            rebuildSource();
            computeTargetCropView();  // aspect changed (swapped)
            afterTransformChange();
        }

        function doFlipH() {
            flipHoriz = !flipHoriz;
            rebuildSource();
            afterTransformChange();
        }

        function doFlipV() {
            flipVert = !flipVert;
            rebuildSource();
            afterTransformChange();
        }

        function resetTransform() {
            if (rotQuarters === 0 && fineAngle === 0 && !flipHoriz && !flipVert) return;
            // Remember if we had an odd rotation so we can swap locked ratio back
            const hadQuarterRot = rotQuarters % 2 !== 0;
            rotQuarters = 0;
            fineAngle = 0;
            flipHoriz = false;
            flipVert = false;
            angleSlider.value = "0";
            angleLabel.textContent = "0°";
            if (hadQuarterRot && lockedRatio !== null && lockedRatio !== 1) {
                lockedRatio = 1 / lockedRatio;
                let found = null;
                for (const [name, val] of Object.entries(STANDARD_RATIOS)) {
                    if (Math.abs(val - lockedRatio) < 0.001) { found = name; break; }
                }
                activeRatioName = found || activeRatioName;
                updateRatioBtns();
            }
            rebuildSource();
            afterTransformChange();
        }

        // Snap to 0° when slider is near center (±1°)
        function onAngleSliderChange() {
            let v = parseFloat(angleSlider.value);
            if (Math.abs(v) < 1) {
                v = 0;
                angleSlider.value = "0";
            }
            fineAngle = v;
            angleLabel.textContent = `${v > 0 ? "+" : ""}${Number.isInteger(v) ? v : v.toFixed(1)}°`;
            // Re-shape crop for the new angle:
            //  - Constrain ON  → inscribed rect (crop shrinks to fit image).
            //  - Constrain OFF → outer bbox of rotated image (crop grows, padding appears).
            if (constrainToImage) applyConstraint();
            else                  applyBoundingBox();
            const L = computeLayoutFor(crop);
            scale = L.scale; offsetX = L.offsetX; offsetY = L.offsetY;
            draw();
        }

        rotCWBtn.onclick      = rotate90CW;
        flipHBtn.onclick      = doFlipH;
        flipVBtn.onclick      = doFlipV;
        angleSlider.oninput   = onAngleSliderChange;

        // ---- Tool switching ----------------------------------------------
        function setTool(tool) {
            activeTool = tool;
            cropToolBtn.style.background = tool === "crop" ? "#4a9eff" : "#3a3a4e";
            cropToolBtn.style.color      = tool === "crop" ? "#fff"    : "#aaa";
            maskToolBtn.style.background = tool === "mask" ? "#4a9eff" : "#3a3a4e";
            maskToolBtn.style.color      = tool === "mask" ? "#fff"    : "#aaa";
            ratioBar.style.display  = tool === "crop" ? "flex" : "none";
            maskRow.style.display   = tool === "mask" ? "flex" : "none";
            xformRow.style.display  = tool === "crop" ? "flex" : "none";
            canvas.style.cursor     = tool === "mask" ? "none" : "crosshair";
            applyBtn.style.display  = (tool === "crop" && hasCropWidgets) ? "" : "none";
            saveMaskBtn.style.display = tool === "mask" ? "" : "none";
            // Reset stays visible in both tools (unified Reset adapts behavior)
            resetBtn.title = tool === "mask" ? "Reset painted mask" : "Reset crop region  (R)";
            draw();
        }

        function setMaskMode(mode) {
            maskMode = mode;
            addModeBtn.style.background    = mode === "add"    ? "#4a9eff" : "#3a3a4e";
            addModeBtn.style.color         = mode === "add"    ? "#fff"    : "#aaa";
            removeModeBtn.style.background = mode === "remove" ? "#4a9eff" : "#3a3a4e";
            removeModeBtn.style.color      = mode === "remove" ? "#fff"    : "#aaa";
        }

        // ---- Mask overlay update -----------------------------------------
        function refreshMaskOverlay() {
            // Mask overlay is in source coords (imgW × imgH); the draw step
            // scales/offsets it into the viewport when compositing.
            maskOverlayCtx.clearRect(0, 0, imgW, imgH);
            maskOverlayCtx.drawImage(maskCanvas, 0, 0);
            maskOverlayCtx.globalCompositeOperation = "source-in";
            maskOverlayCtx.fillStyle = "rgba(255,50,50,0.5)";
            maskOverlayCtx.fillRect(0, 0, imgW, imgH);
            maskOverlayCtx.globalCompositeOperation = "source-over";
        }

        // ---- Draw --------------------------------------------------------
        function draw() {
            ctx.clearRect(0, 0, dispW, dispH);

            const drawW = imgW * scale;
            const drawH = imgH * scale;
            // Rotation pivot = viewport center (crop center is kept there by layout)
            const pivotX = dispW / 2;
            const pivotY = dispH / 2;
            const theta = fineAngle * Math.PI / 180;

            ctx.save();
            ctx.translate(pivotX, pivotY);
            ctx.rotate(theta);
            ctx.translate(-pivotX, -pivotY);

            if (workingCanvas) {
                ctx.drawImage(workingCanvas, offsetX, offsetY, drawW, drawH);
            } else {
                ctx.drawImage(srcCanvas, offsetX, offsetY, drawW, drawH);
            }
            if (maskDirty) ctx.drawImage(maskOverlay, offsetX, offsetY, drawW, drawH);

            ctx.restore();

            if (activeTool === "crop") {
                const cx = crop.x * scale + offsetX, cy = crop.y * scale + offsetY;
                const cw = crop.w * scale, ch = crop.h * scale;

                ctx.fillStyle = "rgba(0,0,0,0.55)";
                ctx.fillRect(0, 0, dispW, cy);
                ctx.fillRect(0, cy + ch, dispW, dispH - cy - ch);
                ctx.fillRect(0, cy, cx, ch);
                ctx.fillRect(cx + cw, cy, dispW - cx - cw, ch);

                ctx.strokeStyle = "#4a9eff"; ctx.lineWidth = 2;
                ctx.strokeRect(cx, cy, cw, ch);

                ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1;
                for (let i = 1; i <= 2; i++) {
                    ctx.beginPath(); ctx.moveTo(cx + cw*i/3, cy); ctx.lineTo(cx + cw*i/3, cy+ch); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(cx, cy + ch*i/3); ctx.lineTo(cx+cw, cy + ch*i/3); ctx.stroke();
                }

                ctx.fillStyle = "#4a9eff";
                const hs = HANDLE;
                for (const [hx, hy] of [[cx,cy],[cx+cw,cy],[cx,cy+ch],[cx+cw,cy+ch]])
                    ctx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
                if (lockedRatio === null)
                    for (const [hx, hy] of [[cx+cw/2,cy],[cx+cw/2,cy+ch],[cx,cy+ch/2],[cx+cw,cy+ch/2]])
                        ctx.fillRect(hx - hs/2, hy - hs/2, hs, hs);

                if (lockedRatio !== null) {
                    ctx.fillStyle = "rgba(74,158,255,0.9)";
                    ctx.font = "bold 11px sans-serif"; ctx.textBaseline = "top"; ctx.textAlign = "left";
                    ctx.fillText("🔒", cx + 5, cy + 4);
                }
            } else if (activeTool === "mask" && mousePos && !eyedropperActive) {
                // Draw brush cursor at actual mouse view position (not src→view)
                const bx = mousePos.vx, by = mousePos.vy;
                const br = brushSize * scale / 2;
                ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2);
                ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.stroke();
                ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2);
                ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
            }

            // (Info label removed — filename field now fills the space)

            // Auto-update save name
            const newAuto = defaultSaveName();
            if (saveNameInput.value === autoSaveName) saveNameInput.value = newAuto;
            autoSaveName = newAuto;
        }

        // ---- Mask paint --------------------------------------------------
        function paintMask(ix, iy) {
            const r = brushSize / 2;
            maskCtx.beginPath();
            maskCtx.arc(ix, iy, r, 0, Math.PI * 2);
            if (maskMode === "add") {
                maskCtx.fillStyle = "white"; maskCtx.fill();
            } else {
                maskCtx.globalCompositeOperation = "destination-out";
                maskCtx.fill();
                maskCtx.globalCompositeOperation = "source-over";
            }
            maskDirty = true;
            refreshMaskOverlay();
        }

        // ---- Apply Mask --------------------------------------------------
        function doApplyMask() {
            if (!maskDirty) { alert("Paint a mask first."); return; }
            maskApplied = true;
            workingCanvas = document.createElement("canvas");
            workingCanvas.width = imgW; workingCanvas.height = imgH;
            const wCtx = workingCanvas.getContext("2d");
            wCtx.drawImage(srcCanvas, 0, 0);

            const id = wCtx.getImageData(0, 0, imgW, imgH);
            const md = maskCtx.getImageData(0, 0, imgW, imgH);

            if (maskFillMode === "transparent") {
                // Masked areas become transparent
                for (let i = 0; i < id.data.length; i += 4) {
                    if (md.data[i] > 128) id.data[i + 3] = 0;
                }
                wCtx.putImageData(id, 0, 0);
            } else if (maskFillMode === "color") {
                // Fill masked areas with solid color
                const r = parseInt(fillColor.slice(1,3), 16);
                const g = parseInt(fillColor.slice(3,5), 16);
                const b = parseInt(fillColor.slice(5,7), 16);
                for (let i = 0; i < id.data.length; i += 4) {
                    if (md.data[i] > 128) {
                        id.data[i] = r; id.data[i+1] = g; id.data[i+2] = b; id.data[i+3] = 255;
                    }
                }
                wCtx.putImageData(id, 0, 0);
            } else if (maskFillMode === "noise") {
                // Fill masked areas with noise matching image stats
                // Compute mean color of non-masked area for a natural look
                let sr = 0, sg = 0, sb = 0, count = 0;
                for (let i = 0; i < id.data.length; i += 4) {
                    if (md.data[i] <= 128) {
                        sr += id.data[i]; sg += id.data[i+1]; sb += id.data[i+2]; count++;
                    }
                }
                const mr = count ? sr/count : 128;
                const mg = count ? sg/count : 128;
                const mb = count ? sb/count : 128;
                for (let i = 0; i < id.data.length; i += 4) {
                    if (md.data[i] > 128) {
                        id.data[i]   = Math.max(0, Math.min(255, mr + (Math.random() - 0.5) * 128));
                        id.data[i+1] = Math.max(0, Math.min(255, mg + (Math.random() - 0.5) * 128));
                        id.data[i+2] = Math.max(0, Math.min(255, mb + (Math.random() - 0.5) * 128));
                        id.data[i+3] = 255;
                    }
                }
                wCtx.putImageData(id, 0, 0);
            } else if (maskFillMode.startsWith("blur")) {
                // Blur masked areas at chosen intensity
                const blurPx = maskFillMode === "blur-light" ? 10
                             : maskFillMode === "blur-heavy" ? 60 : 30;
                wCtx.putImageData(id, 0, 0);
                const blurCanvas = document.createElement("canvas");
                blurCanvas.width = imgW; blurCanvas.height = imgH;
                const blurCtx = blurCanvas.getContext("2d");
                blurCtx.filter = `blur(${blurPx}px)`;
                blurCtx.drawImage(srcCanvas, 0, 0);
                blurCtx.filter = "none";
                // Get blurred pixels
                const blurData = blurCtx.getImageData(0, 0, imgW, imgH);
                // Replace masked pixels with blurred
                const outData = wCtx.getImageData(0, 0, imgW, imgH);
                for (let i = 0; i < outData.data.length; i += 4) {
                    if (md.data[i] > 128) {
                        outData.data[i]   = blurData.data[i];
                        outData.data[i+1] = blurData.data[i+1];
                        outData.data[i+2] = blurData.data[i+2];
                        outData.data[i+3] = 255;
                    }
                }
                wCtx.putImageData(outData, 0, 0);
            }
            draw();
        }

        // ---- Crop geometry -----------------------------------------------
        function hitTest(mx, my) {
            const cx = crop.x * scale + offsetX, cy = crop.y * scale + offsetY;
            const cw = crop.w * scale, ch = crop.h * scale;
            const hs = HANDLE + 4;
            if (Math.abs(mx-cx)     < hs && Math.abs(my-cy)     < hs) return "resize-tl";
            if (Math.abs(mx-(cx+cw))< hs && Math.abs(my-cy)     < hs) return "resize-tr";
            if (Math.abs(mx-cx)     < hs && Math.abs(my-(cy+ch))< hs) return "resize-bl";
            if (Math.abs(mx-(cx+cw))< hs && Math.abs(my-(cy+ch))< hs) return "resize-br";
            if (lockedRatio === null) {
                if (Math.abs(my-cy)     < hs && mx>cx+hs && mx<cx+cw-hs) return "resize-t";
                if (Math.abs(my-(cy+ch))< hs && mx>cx+hs && mx<cx+cw-hs) return "resize-b";
                if (Math.abs(mx-cx)     < hs && my>cy+hs && my<cy+ch-hs) return "resize-l";
                if (Math.abs(mx-(cx+cw))< hs && my>cy+hs && my<cy+ch-hs) return "resize-r";
            }
            if (mx>=cx && mx<=cx+cw && my>=cy && my<=cy+ch) return "move";
            return "draw";
        }

        function getCursor(m) {
            if (m==="resize-tl"||m==="resize-br") return "nwse-resize";
            if (m==="resize-tr"||m==="resize-bl") return "nesw-resize";
            if (m==="resize-t" ||m==="resize-b")  return "ns-resize";
            if (m==="resize-l" ||m==="resize-r")  return "ew-resize";
            if (m==="move") return "move";
            return "crosshair";
        }

        function applyResize(mode, dx, dy) {
            const s = dragCropStart;
            if (mode === "move") {
                crop.x = Math.max(0, Math.min(s.x + dx, imgW - s.w));
                crop.y = Math.max(0, Math.min(s.y + dy, imgH - s.h));
                crop.w = s.w; crop.h = s.h;
            } else if (lockedRatio !== null) {
                applyRatioResize(mode, dx, dy, s);
            } else {
                applyFreeResize(mode, dx, dy, s);
                if (crop.w < 0) { crop.x += crop.w; crop.w = -crop.w; }
                if (crop.h < 0) { crop.y += crop.h; crop.h = -crop.h; }
                clampCrop(crop, imgW, imgH);
            }
        }

        function applyFreeResize(mode, dx, dy, s) {
            if (mode === "draw") {
                const ix = Math.max(0, Math.min(dragStart[0]+dx, imgW));
                const iy = Math.max(0, Math.min(dragStart[1]+dy, imgH));
                crop.x = Math.min(dragStart[0], ix); crop.y = Math.min(dragStart[1], iy);
                crop.w = Math.abs(ix-dragStart[0]); crop.h = Math.abs(iy-dragStart[1]);
            } else if (mode==="resize-br") { crop.w=s.w+dx; crop.h=s.h+dy; }
            else if (mode==="resize-bl") { crop.x=s.x+dx; crop.w=s.w-dx; crop.h=s.h+dy; }
            else if (mode==="resize-tr") { crop.y=s.y+dy; crop.w=s.w+dx; crop.h=s.h-dy; }
            else if (mode==="resize-tl") { crop.x=s.x+dx; crop.y=s.y+dy; crop.w=s.w-dx; crop.h=s.h-dy; }
            else if (mode==="resize-t")  { crop.y=s.y+dy; crop.h=s.h-dy; }
            else if (mode==="resize-b")  { crop.h=s.h+dy; }
            else if (mode==="resize-l")  { crop.x=s.x+dx; crop.w=s.w-dx; }
            else if (mode==="resize-r")  { crop.w=s.w+dx; }
        }

        function applyRatioResize(mode, dx, dy, s) {
            const R = lockedRatio;
            let nw, nh, nx, ny;
            if (mode==="draw")       { nw=Math.max(20,Math.abs(dx)); nh=nw/R; nx=dx>0?dragStart[0]:dragStart[0]-nw; ny=dy>0?dragStart[1]:dragStart[1]-nh; }
            else if(mode==="resize-br"){ nw=Math.max(20,s.w+dx); nh=nw/R; nx=s.x; ny=s.y; }
            else if(mode==="resize-bl"){ nw=Math.max(20,s.w-dx); nh=nw/R; nx=s.x+s.w-nw; ny=s.y; }
            else if(mode==="resize-tr"){ nw=Math.max(20,s.w+dx); nh=nw/R; nx=s.x; ny=s.y+s.h-nh; }
            else if(mode==="resize-tl"){ nw=Math.max(20,s.w-dx); nh=nw/R; nx=s.x+s.w-nw; ny=s.y+s.h-nh; }
            else return;
            if (nx<0)        { nw+=nx; nh=nw/R; nx=0; if(mode==="resize-tl"||mode==="resize-tr") ny=s.y+s.h-nh; }
            if (ny<0)        { nh+=ny; nw=nh*R; ny=0; if(mode==="resize-tl"||mode==="resize-bl") nx=s.x+s.w-nw; }
            if (nx+nw>imgW)  { nw=imgW-nx; nh=nw/R; if(mode==="resize-tl"||mode==="resize-tr") ny=s.y+s.h-nh; }
            if (ny+nh>imgH)  { nh=imgH-ny; nw=nh*R; if(mode==="resize-tl"||mode==="resize-bl") nx=s.x+s.w-nw; }
            nw=Math.max(20,nw); nh=Math.max(20,nw/R);
            crop.x=nx; crop.y=ny; crop.w=nw; crop.h=nh;
        }

        // View→src conversion with inverse fine rotation around crop view center.
        // Used for mask painting where the user clicks the ROTATED image.
        function viewToSrcRotated(mx, my) {
            const cropCX = offsetX + (crop.x + crop.w / 2) * scale;
            const cropCY = offsetY + (crop.y + crop.h / 2) * scale;
            const theta = -fineAngle * Math.PI / 180;  // inverse
            const dx = mx - cropCX, dy = my - cropCY;
            const rx = dx * Math.cos(theta) - dy * Math.sin(theta);
            const ry = dx * Math.sin(theta) + dy * Math.cos(theta);
            return {
                ix: (rx + cropCX - offsetX) / scale,
                iy: (ry + cropCY - offsetY) / scale,
            };
        }

        // Pan state: remembers starting conditions for image-pan drag
        let panStart = null;

        // Helper: current mouse position relative to canvas (coords may be
        // negative or exceed dispW/dispH when mouse is outside the canvas —
        // that's fine for ongoing drags, and the hover-path bails on that).
        function canvasCoords(e) {
            const r = canvas.getBoundingClientRect();
            return { mx: e.clientX - r.left, my: e.clientY - r.top, r };
        }
        function isInsideCanvas(mx, my) {
            return mx >= 0 && my >= 0 && mx < dispW && my < dispH;
        }

        // ---- Canvas / window events --------------------------------------
        // mousemove / mouseup live on `window` so drags and strokes continue
        // even when the mouse leaves the canvas (the rest of the screen is
        // the semi-transparent overlay anyway). Refs kept so cleanup() can
        // remove them.
        const onWinMouseMove = (e) => {
            const { mx, my } = canvasCoords(e);
            if (activeTool === "mask") {
                // Hide brush cursor when mouse is outside canvas (but keep painting)
                if (isInsideCanvas(mx, my)) {
                    const { ix, iy } = viewToSrcRotated(mx, my);
                    mousePos = { x: ix, y: iy, vx: mx, vy: my };
                } else {
                    mousePos = null;
                }
                if (painting && !eyedropperActive) {
                    const { ix, iy } = viewToSrcRotated(mx, my);
                    paintMask(ix, iy);
                }
                draw(); return;
            }
            // Crop tool
            mousePos = null;
            if (!dragMode) {
                // Only update hover cursor when inside the canvas
                if (isInsideCanvas(mx, my)) canvas.style.cursor = getCursor(hitTest(mx, my));
                return;
            }
            if (dragMode === "move") {
                // PAN: image shifts under a fixed crop.
                const dmx = mx - panStart.mx;
                const dmy = my - panStart.my;
                let nx = panStart.cropX - dmx / scale;
                let ny = panStart.cropY - dmy / scale;
                crop.x = nx; crop.y = ny;
                if (constrainToImage) {
                    clampCropConstrained();
                } else {
                    // Unconstrained: allow crop to leave the image for padding.
                    // No clamping — user can pan anywhere.
                }
                offsetX = Math.round(dispW / 2 - (crop.x + crop.w / 2) * scale);
                offsetY = Math.round(dispH / 2 - (crop.y + crop.h / 2) * scale);
                draw();
                return;
            }
            // Draw / resize: both manipulate crop dims in src coords
            const ix = (mx - offsetX) / scale, iy = (my - offsetY) / scale;
            applyResize(dragMode, ix - dragStart[0], iy - dragStart[1]);
            if (constrainToImage) clampCropConstrained();
            draw();
        };
        window.addEventListener("mousemove", onWinMouseMove);

        // Note: canvas.mouseleave intentionally NOT used — we want drags to
        // continue when the mouse leaves the canvas. mousePos visibility for
        // the brush cursor is handled in the window mousemove handler.

        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0 && e.button !== 2) return;
            const { mx, my } = canvasCoords(e);
            let ix, iy;
            if (activeTool === "mask") {
                ({ ix, iy } = viewToSrcRotated(mx, my));
            } else {
                ix = (mx - offsetX) / scale;
                iy = (my - offsetY) / scale;
            }

            if (activeTool === "mask") {
                if (eyedropperActive) {
                    // Pick color from original image
                    const pickCanvas = document.createElement("canvas");
                    pickCanvas.width = imgW; pickCanvas.height = imgH;
                    const pCtx = pickCanvas.getContext("2d");
                    pCtx.drawImage(srcCanvas, 0, 0);
                    const px = Math.round(Math.max(0, Math.min(ix, imgW-1)));
                    const py = Math.round(Math.max(0, Math.min(iy, imgH-1)));
                    const pd = pCtx.getImageData(px, py, 1, 1).data;
                    fillColor = `#${pd[0].toString(16).padStart(2,'0')}${pd[1].toString(16).padStart(2,'0')}${pd[2].toString(16).padStart(2,'0')}`;
                    colorInput.value = fillColor;
                    eyedropperActive = false;
                    eyedropperBtn.style.background = "#3a3a4e";
                    eyedropperBtn.style.color = "#aaa";
                    canvas.style.cursor = "none";
                    draw();
                    return;
                }
                setMaskMode(e.button === 2 ? "remove" : "add");
                pushMaskHistory(); // save state before stroke begins
                painting = true;
                paintMask(ix, iy); draw(); return;
            }
            dragMode = hitTest(mx, my);
            dragStart = [ix, iy];
            dragCropStart = { ...crop };
            if (dragMode === "move") {
                // Start a pan drag — record starting state
                panStart = {
                    mx: mx,
                    my: my,
                    cropX: crop.x,
                    cropY: crop.y,
                    offsetX: offsetX,
                    offsetY: offsetY,
                };
            }
        });

        const onWinMouseUp = () => {
            if (activeTool === "mask") { painting = false; return; }
            if (!dragMode) return;
            const wasResize = dragMode && dragMode.startsWith("resize");
            dragMode = null;
            panStart = null;
            if (constrainToImage) clampCropConstrained();
            else if (lockedRatio === null) {
                // Unconstrained + free ratio: keep crop valid size only (no image clamp)
                crop.w = Math.max(4, crop.w);
                crop.h = Math.max(4, crop.h);
            }
            if (wasResize) {
                // Resize finished — animate to the new layout (zoom to fit crop)
                reLayoutAnimated();
            } else {
                draw();
            }
        };
        window.addEventListener("mouseup", onWinMouseUp);

        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        // Wheel:
        //   - Mask tool: adjust brush size
        //   - Crop tool: zoom the IMAGE under a static crop rect. The rect's
        //     view-space size and position stay fixed; scale changes and
        //     crop.w/h change inversely so crop.w*scale (the rect's view
        //     size) remains constant. This means zooming actually changes
        //     which src pixels fall inside the "viewfinder" — exactly the
        //     mental model the user wants.
        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            if (activeTool === "mask") {
                brushSize = Math.max(4, Math.min(200, brushSize - Math.sign(e.deltaY) * 4));
                brushSlider.value = String(brushSize);
                bSzLabel.textContent = String(brushSize);
                draw();
                return;
            }
            // Crop tool zoom — rect is static in view
            const cropViewW = crop.w * scale; // keep constant
            const cropViewH = crop.h * scale;
            if (cropViewW < 1 || cropViewH < 1) return;
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            // Bounds:
            //   Constrain ON: minScale = inscribed-rect-max for current angle+aspect
            //                 (so zooming out can't push crop beyond the image).
            //   Constrain OFF: minScale small (0.05) so user can zoom way out and
            //                  add lots of padding.
            //   maxScale: crop's src size ≥ ~10 px (same for both modes).
            let minScale;
            if (constrainToImage) {
                const aspect = lockedRatio !== null ? lockedRatio : (crop.w / Math.max(crop.h, 1));
                const maxRect = computeInscribedRect(imgW, imgH, fineAngle, aspect);
                minScale = Math.max(cropViewW / maxRect.w, cropViewH / maxRect.h);
            } else {
                minScale = 0.01;
            }
            const maxScale = Math.min(cropViewW / 10, cropViewH / 10);
            let newScale = scale * factor;
            newScale = Math.max(minScale, Math.min(maxScale, newScale));
            if (Math.abs(newScale - scale) < 1e-6) return;
            // Keep crop center in src coords (clamped inside image with new size)
            const cxSrc = crop.x + crop.w / 2;
            const cySrc = crop.y + crop.h / 2;
            const newCropW = cropViewW / newScale;
            const newCropH = cropViewH / newScale;
            crop.w = newCropW;
            crop.h = newCropH;
            crop.x = cxSrc - newCropW / 2;
            crop.y = cySrc - newCropH / 2;
            if (constrainToImage) clampCropConstrained();
            // Unconstrained: crop may extend outside image (padding) — no clamp
            scale = newScale;
            // Re-center so crop (and rotation pivot) stays at viewport center
            offsetX = Math.round(dispW / 2 - (crop.x + crop.w / 2) * scale);
            offsetY = Math.round(dispH / 2 - (crop.y + crop.h / 2) * scale);
            draw();
        }, { passive: false });

        // ---- Actions -----------------------------------------------------
        // Responsive: recompute viewport, rows, and layout when the window resizes.
        function onWindowResize() {
            const vp = computeViewport();
            dispW = vp.w; dispH = vp.h;
            canvas.width = dispW; canvas.height = dispH;
            row1.style.width = `${dispW}px`;
            row2.style.width = `${dispW}px`;
            xformRow.style.width = `${dispW}px`;
            computeTargetCropView();
            recomputeLayout();
            draw();
        }
        window.addEventListener("resize", onWindowResize);

        function cleanup() {
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onWindowResize);
            window.removeEventListener("mousemove", onWinMouseMove);
            window.removeEventListener("mouseup", onWinMouseUp);
            overlay.remove();
        }

        function applyCrop() {
            xWidget.value = Math.round(crop.x);
            yWidget.value = Math.round(crop.y);
            wWidget.value = Math.round(crop.w);
            hWidget.value = Math.round(crop.h);
            import("../../scripts/app.js").then(({ app }) => { app.graph.setDirtyCanvas(true); });
            cleanup();
        }

        async function doSave() {
            // Output resolution factor `k`: maps source pixels → output pixels.
            //   match: downscale to source short side (k ≤ 1)
            //   native: k = 1 (1:1 with source)
            //   balanced: geometric mean of match and native
            const origShort = Math.min(origW, origH);
            const cropShort = Math.max(1, Math.min(crop.w, crop.h));
            const kMatch    = Math.min(1, origShort / cropShort);
            const kNative   = 1;
            const kBalanced = Math.sqrt(kMatch * kNative);
            const k = resMode === "match"    ? kMatch
                    : resMode === "native"   ? kNative
                    : kBalanced;
            const cw = Math.max(1, Math.round(crop.w * k));
            const ch = Math.max(1, Math.round(crop.h * k));
            if (cw < 1 || ch < 1) { alert("Crop region too small."); return; }
            const cropCX = crop.x + crop.w / 2;
            const cropCY = crop.y + crop.h / 2;
            const theta = fineAngle * Math.PI / 180;
            const off = document.createElement("canvas");
            off.width = cw; off.height = ch;
            const octx = off.getContext("2d");
            // Padding: fill the background first so any crop area that lies
            // outside the source image is filled with the chosen mode.
            //   transparent → leave blank (PNG/WebP alpha will be 0)
            //   color       → solid padColor
            //   noise       → random RGB noise
            if (padMode === "color") {
                octx.fillStyle = padColorInput.value;
                octx.fillRect(0, 0, cw, ch);
            } else if (padMode === "noise") {
                const id = octx.createImageData(cw, ch);
                for (let i = 0; i < id.data.length; i += 4) {
                    id.data[i]   = (Math.random() * 256) | 0;
                    id.data[i+1] = (Math.random() * 256) | 0;
                    id.data[i+2] = (Math.random() * 256) | 0;
                    id.data[i+3] = 255;
                }
                octx.putImageData(id, 0, 0);
            }
            // Apply fine rotation around the crop center. The source canvas
            // is drawn in source pixels, then the whole output is scaled by k.
            octx.save();
            octx.translate(cw / 2, ch / 2);
            octx.scale(k, k);           // output scale
            octx.rotate(theta);
            octx.drawImage(workingCanvas || srcCanvas, -cropCX, -cropCY);
            octx.restore();
            const ok = await uploadCanvas(off, saveNameInput.value.trim(), sourceSubfolder, saveBtn, onSaved);
            if (ok) cleanup();
        }

        async function doSaveMask() {
            if (!maskDirty) { alert("Paint a mask first."); return; }
            await uploadCanvas(maskCanvas, maskNameInput.value.trim(), sourceSubfolder, saveMaskBtn, null);
        }

        function resetCrop() {
            if (constrainToImage) applyConstraint();
            else                  applyBoundingBox();
            const L = computeLayoutFor(crop);
            scale = L.scale; offsetX = L.offsetX; offsetY = L.offsetY;
            draw();
        }

        // Full reset: undo crop + all transform (rotation + flips).
        function doFullReset() {
            // Reset transform state without rebuilding just yet
            const hadQuarterRot = rotQuarters % 2 !== 0;
            rotQuarters = 0;
            fineAngle = 0;
            flipHoriz = false;
            flipVert = false;
            angleSlider.value = "0";
            angleLabel.textContent = "0°";
            if (hadQuarterRot && lockedRatio !== null && lockedRatio !== 1) {
                lockedRatio = 1 / lockedRatio;
                let found = null;
                for (const [name, val] of Object.entries(STANDARD_RATIOS)) {
                    if (Math.abs(val - lockedRatio) < 0.001) { found = name; break; }
                }
                activeRatioName = found || activeRatioName;
                updateRatioBtns();
            }
            rebuildSource();
            afterTransformChange();
        }

        function doClearMask() {
            maskCtx.clearRect(0, 0, imgW, imgH);
            maskOverlayCtx.clearRect(0, 0, imgW, imgH);
            maskDirty = false;
            maskApplied = false;
            workingCanvas = null;
            draw();
        }

        // ---- Wire buttons ------------------------------------------------
        // Unified Reset:
        //   Mask mode → clear painted mask.
        //   Crop mode → reset transform (rotation + flips) AND crop region.
        function doReset() {
            if (activeTool === "mask") doClearMask();
            else doFullReset();
        }
        cancelBtn.onclick     = cleanup;
        resetBtn.onclick      = doReset;
        applyBtn.onclick      = applyCrop;
        saveBtn.onclick       = doSave;
        saveMaskBtn.onclick   = doSaveMask;
        applyMaskBtn.onclick  = doApplyMask;
        undoBtn.onclick       = undoMask;
        redoBtn.onclick       = redoMask;
        cropToolBtn.onclick   = () => setTool("crop");
        maskToolBtn.onclick   = () => setTool("mask");
        addModeBtn.onclick    = () => setMaskMode("add");
        removeModeBtn.onclick = () => setMaskMode("remove");

        // ---- Keyboard ----------------------------------------------------
        const onKey = (e) => {
            // Don't handle keys when typing in text inputs
            if (e.target.tagName === "INPUT" && e.target.type === "text") return;
            if (e.key === "Escape") cleanup();
            else if (e.key === "Enter" && hasCropWidgets && activeTool === "crop") applyCrop();
            else if ((e.key === "r" || e.key === "R") && activeTool === "crop") resetCrop();
            else if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey && activeTool === "mask") { e.preventDefault(); undoMask(); }
            else if (e.key === "y" && (e.ctrlKey || e.metaKey) && activeTool === "mask") { e.preventDefault(); redoMask(); }
            else if (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey && activeTool === "mask") { e.preventDefault(); redoMask(); }
        };
        document.addEventListener("keydown", onKey);

        // ---- Initial state -----------------------------------------------
        maskNameInput.value = defaultMaskName();
        setTool("crop");
        setMaskMode("add");
        draw();

      } catch (err) {
        console.error("CropEditor img.onload error:", err);
        earlyCleanup();
        alert("Editor failed to initialize: " + err.message);
      }
    };

    const sep = imgUrl.includes("?") ? "&" : "?";
    img.src = imgUrl + sep + "_cb=" + Date.now();
}
