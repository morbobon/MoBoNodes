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
    return base.replace(/(_copy|_cropped|_crop-[0-9]+x[0-9]+|_masked|_filled|_noised|_blurred)+$/, "");
}

function buildPostfix(crop, imgW, imgH, maskApplied, fillMode) {
    const cropped = crop.x !== 0 || crop.y !== 0 ||
                    Math.round(crop.w) !== imgW || Math.round(crop.h) !== imgH;
    if (!cropped && !maskApplied) return "_copy";
    let p = "";
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
        display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
        padding-top:10px;overflow-y:auto;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        color:#fff;user-select:none;
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

        const imgW  = img.naturalWidth;
        const imgH  = img.naturalHeight;
        const maxW  = window.innerWidth  - 40;
        const maxH  = window.innerHeight - 200;
        const scale = Math.min(maxW / imgW, maxH / imgH, 1);
        const dispW = Math.floor(imgW * scale);
        const dispH = Math.floor(imgH * scale);

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
        let crop = {
            x: xWidget?.value || 0,
            y: yWidget?.value || 0,
            w: wWidget?.value || imgW,
            h: hWidget?.value || imgH,
        };
        if (crop.w === 512 && crop.h === 512 && imgW !== 512) {
            crop = { x: 0, y: 0, w: imgW, h: imgH };
        }
        if (lockedRatio !== null) crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
        clampCrop(crop, imgW, imgH);

        let dragMode = null, dragStart = null, dragCropStart = null;
        const HANDLE = 8;

        // Mask state
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = imgW; maskCanvas.height = imgH;
        const maskCtx = maskCanvas.getContext("2d");

        const maskOverlay = document.createElement("canvas");
        maskOverlay.width = dispW; maskOverlay.height = dispH;
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
            return `${srcBase}${buildPostfix(crop, imgW, imgH, maskApplied, maskFillMode)}.${srcExt}`;
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

        const infoLabel = document.createElement("span");
        infoLabel.style.cssText = "font-size:12px;font-family:monospace;color:#66ccff;flex:1;";
        row1.appendChild(infoLabel);

        const saveNameInput = document.createElement("input");
        saveNameInput.type = "text";
        saveNameInput.style.cssText = `
            padding:5px 9px;background:#2a2a3e;color:#fff;border:1px solid #555;
            border-radius:5px;font-size:13px;width:190px;outline:none;
        `;
        saveNameInput.value = autoSaveName;
        row1.appendChild(saveNameInput);

        const saveBtn = mkBtn("💾 Save", "#2d6b3f");
        row1.appendChild(saveBtn);

        const resetBtn = mkBtn("Reset", "#3a3a4e", "#aaa");
        resetBtn.title = "Reset crop to full image  (R)";
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
                crop = lockedRatio !== null
                    ? fitCropToRatio({ x: 0, y: 0, w: imgW, h: imgH }, lockedRatio, imgW, imgH)
                    : { x: 0, y: 0, w: imgW, h: imgH };
                draw();
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

        // Apply Mask / Reset Mask
        const applyMaskBtn = mkBtn("Apply Mask", "#7b2d2d");
        maskRow.appendChild(applyMaskBtn);
        const clearMaskBtn = mkBtn("Reset Mask", "#3a3a4e", "#aaa");
        clearMaskBtn.title = "Clear all painted mask";
        maskRow.appendChild(clearMaskBtn);

        const msep4 = document.createElement("div");
        msep4.style.cssText = "width:1px;height:20px;background:#444;";
        maskRow.appendChild(msep4);

        // Save Mask
        const maskNameInput = document.createElement("input");
        maskNameInput.type = "text";
        maskNameInput.style.cssText = `padding:5px 9px;background:#2a2a3e;color:#fff;border:1px solid #555;
            border-radius:5px;font-size:13px;width:140px;outline:none;`;
        maskRow.appendChild(maskNameInput);
        const saveMaskBtn = mkBtn("💾 Mask", "#2d6b3f");
        maskRow.appendChild(saveMaskBtn);

        // ---- Canvas ------------------------------------------------------
        const canvas = document.createElement("canvas");
        canvas.width = dispW; canvas.height = dispH;
        canvas.style.cssText = "cursor:crosshair;display:block;";
        overlay.appendChild(canvas);
        const ctx = canvas.getContext("2d");

        // ---- Tool switching ----------------------------------------------
        function setTool(tool) {
            activeTool = tool;
            cropToolBtn.style.background = tool === "crop" ? "#4a9eff" : "#3a3a4e";
            cropToolBtn.style.color      = tool === "crop" ? "#fff"    : "#aaa";
            maskToolBtn.style.background = tool === "mask" ? "#4a9eff" : "#3a3a4e";
            maskToolBtn.style.color      = tool === "mask" ? "#fff"    : "#aaa";
            ratioBar.style.display  = tool === "crop" ? "flex" : "none";
            maskRow.style.display   = tool === "mask" ? "flex" : "none";
            canvas.style.cursor     = tool === "mask" ? "none" : "crosshair";
            applyBtn.style.display  = (tool === "crop" && hasCropWidgets) ? "" : "none";
            resetBtn.style.display  = tool === "crop" ? "" : "none";
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
            maskOverlayCtx.clearRect(0, 0, dispW, dispH);
            maskOverlayCtx.drawImage(maskCanvas, 0, 0, dispW, dispH);
            maskOverlayCtx.globalCompositeOperation = "source-in";
            maskOverlayCtx.fillStyle = "rgba(255,50,50,0.5)";
            maskOverlayCtx.fillRect(0, 0, dispW, dispH);
            maskOverlayCtx.globalCompositeOperation = "source-over";
        }

        // ---- Draw --------------------------------------------------------
        function draw() {
            ctx.clearRect(0, 0, dispW, dispH);

            if (workingCanvas) {
                drawCheckerboard(ctx, dispW, dispH);
                ctx.drawImage(workingCanvas, 0, 0, dispW, dispH);
            } else {
                ctx.drawImage(img, 0, 0, dispW, dispH);
            }
            // Always show mask overlay when there's paint (even after apply)
            if (maskDirty) ctx.drawImage(maskOverlay, 0, 0);

            if (activeTool === "crop") {
                const cx = crop.x * scale, cy = crop.y * scale;
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
                const bx = mousePos.x * scale, by = mousePos.y * scale;
                const br = brushSize * scale / 2;
                ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2);
                ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.stroke();
                ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2);
                ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
            }

            // Info label
            if (activeTool === "crop") {
                const rs = (crop.w / crop.h).toFixed(3);
                const lbl = activeRatioName === "Free" ? "Freeform"
                          : activeRatioName === "Image" ? `Image (${imageRatio.name})`
                          : activeRatioName;
                infoLabel.textContent = `${lbl}  |  ${Math.round(crop.w)}×${Math.round(crop.h)}  (${rs})  X:${Math.round(crop.x)} Y:${Math.round(crop.y)}`;
            } else {
                infoLabel.textContent = `Mask · ${maskMode} · brush Ø${brushSize}px` +
                    (maskDirty ? "  (painted)" : "") +
                    (maskApplied ? `  ✓ applied [${maskFillMode}]` : "");
            }

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
            wCtx.drawImage(img, 0, 0);

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
                blurCtx.drawImage(img, 0, 0);
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
            const cx = crop.x*scale, cy = crop.y*scale;
            const cw = crop.w*scale, ch = crop.h*scale;
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

        // ---- Canvas events -----------------------------------------------
        canvas.addEventListener("mousemove", (e) => {
            const r  = canvas.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;
            if (activeTool === "mask") {
                mousePos = { x: mx / scale, y: my / scale };
                if (painting && !eyedropperActive) paintMask(mousePos.x, mousePos.y);
                draw(); return;
            }
            mousePos = null;
            if (!dragMode) { canvas.style.cursor = getCursor(hitTest(mx, my)); return; }
            applyResize(dragMode, (mx/scale)-dragStart[0], (my/scale)-dragStart[1]);
            draw();
        });

        canvas.addEventListener("mouseleave", () => { mousePos = null; draw(); });

        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0 && e.button !== 2) return;
            const r  = canvas.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;
            const ix = mx / scale, iy = my / scale;

            if (activeTool === "mask") {
                if (eyedropperActive) {
                    // Pick color from original image
                    const pickCanvas = document.createElement("canvas");
                    pickCanvas.width = imgW; pickCanvas.height = imgH;
                    const pCtx = pickCanvas.getContext("2d");
                    pCtx.drawImage(img, 0, 0);
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
            if (dragMode === "draw") {
                crop.x = ix; crop.y = iy;
                crop.w = 1; crop.h = lockedRatio ? 1/lockedRatio : 1;
            }
        });

        canvas.addEventListener("mouseup", () => {
            if (activeTool === "mask") { painting = false; return; }
            dragMode = null;
            if (lockedRatio === null) clampCrop(crop, imgW, imgH);
            draw();
        });

        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        canvas.addEventListener("wheel", (e) => {
            if (activeTool !== "mask") return;
            e.preventDefault();
            brushSize = Math.max(4, Math.min(200, brushSize - Math.sign(e.deltaY) * 4));
            brushSlider.value = String(brushSize);
            bSzLabel.textContent = String(brushSize);
            draw();
        }, { passive: false });

        // ---- Actions -----------------------------------------------------
        function cleanup() {
            document.removeEventListener("keydown", onKey);
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
            const cx = Math.round(crop.x), cy = Math.round(crop.y);
            const cw = Math.round(crop.w), ch = Math.round(crop.h);
            if (cw < 1 || ch < 1) { alert("Crop region too small."); return; }
            const off = document.createElement("canvas");
            off.width = cw; off.height = ch;
            off.getContext("2d").drawImage(workingCanvas || img, cx, cy, cw, ch, 0, 0, cw, ch);
            const ok = await uploadCanvas(off, saveNameInput.value.trim(), sourceSubfolder, saveBtn, onSaved);
            if (ok) cleanup();
        }

        async function doSaveMask() {
            if (!maskDirty) { alert("Paint a mask first."); return; }
            await uploadCanvas(maskCanvas, maskNameInput.value.trim(), sourceSubfolder, saveMaskBtn, null);
        }

        function resetCrop() {
            crop = { x: 0, y: 0, w: imgW, h: imgH };
            if (lockedRatio !== null) crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
            draw();
        }

        function doClearMask() {
            maskCtx.clearRect(0, 0, imgW, imgH);
            maskOverlayCtx.clearRect(0, 0, dispW, dispH);
            maskDirty = false;
            maskApplied = false;
            workingCanvas = null;
            draw();
        }

        // ---- Wire buttons ------------------------------------------------
        cancelBtn.onclick     = cleanup;
        resetBtn.onclick      = resetCrop;
        applyBtn.onclick      = applyCrop;
        saveBtn.onclick       = doSave;
        saveMaskBtn.onclick   = doSaveMask;
        applyMaskBtn.onclick  = doApplyMask;
        clearMaskBtn.onclick  = doClearMask;
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
