import { app } from "../../scripts/app.js";

const STANDARD_RATIOS = {
    "1:1": 1, "4:3": 4/3, "3:4": 3/4, "5:4": 5/4, "4:5": 4/5,
    "3:2": 3/2, "2:3": 2/3, "16:9": 16/9, "9:16": 9/16,
    "16:10": 16/10, "10:16": 10/16, "21:9": 21/9, "9:21": 9/21,
    "2:1": 2, "1:2": 1/2,
};

function findClosestStandardRatio(w, h) {
    if (h === 0) return { name: "1:1", value: 1 };
    const actual = w / h;
    let best = "1:1", bestDiff = Infinity;
    for (const [name, val] of Object.entries(STANDARD_RATIOS)) {
        const diff = Math.abs(actual - val);
        if (diff < bestDiff) { bestDiff = diff; best = name; }
    }
    return { name: best, value: STANDARD_RATIOS[best] };
}

app.registerExtension({
    name: "mobo.InteractiveCrop",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "MoBo_InteractiveCrop") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            const node = this;
            const xWidget = node.widgets.find(w => w.name === "crop_x");
            const yWidget = node.widgets.find(w => w.name === "crop_y");
            const wWidget = node.widgets.find(w => w.name === "crop_width");
            const hWidget = node.widgets.find(w => w.name === "crop_height");
            if (!xWidget || !yWidget || !wWidget || !hWidget) return;

            node.addWidget("button", "✂️ Select Crop Region", null, () => {
                const imageInput = node.inputs?.find(i => i.name === "image");
                if (!imageInput || !imageInput.link) {
                    alert("Connect an image first before selecting crop region.");
                    return;
                }

                const linkInfo = app.graph.links[imageInput.link];
                if (!linkInfo) return;
                const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                if (!sourceNode) return;

                let imgUrl = null;
                let sourceFilename = "";
                let sourceSubfolder = "";

                if (sourceNode.imgs && sourceNode.imgs.length > 0) {
                    imgUrl = sourceNode.imgs[0].src;
                }
                // Also try to get filename/subfolder from widget for saving
                const imgWidget = sourceNode.widgets?.find(w => w.name === "image");
                if (imgWidget && imgWidget.value) {
                    sourceFilename = imgWidget.value;
                    const subWidget = sourceNode.widgets?.find(w => w.name === "subfolder");
                    sourceSubfolder = subWidget ? (subWidget.value === "." ? "" : subWidget.value) : "";
                    if (!imgUrl) {
                        imgUrl = `/view?filename=${encodeURIComponent(sourceFilename)}&subfolder=${encodeURIComponent(sourceSubfolder)}&type=input`;
                    }
                }
                if (!imgUrl) {
                    alert("Cannot preview the source image. Run the workflow once first, or connect to a Load Image node.");
                    return;
                }

                openCropEditor(imgUrl, xWidget, yWidget, wWidget, hWidget, node, sourceFilename, sourceSubfolder);
            });
        };
    },
});


function openCropEditor(imgUrl, xWidget, yWidget, wWidget, hWidget, node, sourceFilename, sourceSubfolder) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.88); z-index: 100000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #fff; user-select: none;
    `;
    document.body.appendChild(overlay);

    // --- Header bar ---
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex; align-items: center; gap: 12px; padding: 10px 16px;
        background: #1a1a2e; border-radius: 8px; margin-bottom: 8px; flex-wrap: wrap;
    `;
    overlay.appendChild(header);

    // Ratio buttons container
    const ratioBar = document.createElement("div");
    ratioBar.style.cssText = "display: flex; gap: 4px; flex-wrap: wrap; align-items: center;";
    header.appendChild(ratioBar);

    // Spacer
    const spacer = document.createElement("div");
    spacer.style.cssText = "flex: 1;";
    header.appendChild(spacer);

    // Info label
    const infoLabel = document.createElement("span");
    infoLabel.style.cssText = "font-size: 12px; font-family: monospace; color: #66ccff; min-width: 300px; text-align: right;";
    header.appendChild(infoLabel);

    // Save Cropped / Reset / Apply / Cancel
    const saveCropBtn = document.createElement("button");
    saveCropBtn.textContent = "💾 Save Cropped";
    saveCropBtn.style.cssText = `
        padding: 7px 14px; background: #2d6b3f; color: #fff; border: none;
        border-radius: 5px; cursor: pointer; font-size: 13px;
    `;
    header.appendChild(saveCropBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset";
    resetBtn.style.cssText = `
        padding: 7px 14px; background: #3a3a4e; color: #aaa; border: none;
        border-radius: 5px; cursor: pointer; font-size: 13px;
    `;
    header.appendChild(resetBtn);

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.style.cssText = `
        padding: 7px 20px; background: #4a9eff; color: #fff; border: none;
        border-radius: 5px; cursor: pointer; font-size: 13px; font-weight: 600;
    `;
    header.appendChild(applyBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = `
        padding: 7px 14px; background: #555; color: #fff; border: none;
        border-radius: 5px; cursor: pointer; font-size: 13px;
    `;
    header.appendChild(cancelBtn);

    // Canvas
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "cursor: crosshair; border-radius: 4px;";
    overlay.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
        const maxW = window.innerWidth - 40;
        const maxH = window.innerHeight - 130;
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        const dispW = Math.floor(img.naturalWidth * scale);
        const dispH = Math.floor(img.naturalHeight * scale);
        canvas.width = dispW;
        canvas.height = dispH;

        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;

        // --- Ratio state ---
        // The image's own ratio (closest standard match)
        const imageRatio = findClosestStandardRatio(imgW, imgH);
        const imageExactRatio = imgW / imgH;

        // Active ratio: null = freeform, number = locked
        let activeRatioName = "Image";
        let lockedRatio = imageExactRatio; // default: snap to input image ratio

        // --- Build ratio buttons ---
        const ratioButtons = {};

        function makeBtn(label, ratioValue, ratioName) {
            const btn = document.createElement("button");
            btn.textContent = label;
            btn.dataset.ratioName = ratioName;
            btn.style.cssText = `
                padding: 4px 9px; border: 1px solid #444; border-radius: 4px;
                background: #2a2a3e; color: #aaa; cursor: pointer; font-size: 11px;
                transition: all 0.15s;
            `;
            btn.addEventListener("click", () => {
                activeRatioName = ratioName;
                lockedRatio = ratioValue;
                updateButtonStates();
                // Reset to largest possible crop for this ratio
                if (lockedRatio !== null) {
                    crop = fitCropToRatio({ x: 0, y: 0, w: imgW, h: imgH }, lockedRatio, imgW, imgH);
                } else {
                    crop = { x: 0, y: 0, w: imgW, h: imgH };
                }
                draw();
            });
            ratioBar.appendChild(btn);
            ratioButtons[ratioName] = btn;
        }

        // "Free" button
        makeBtn("Free", null, "Free");

        // "Image" button — the input image's own ratio
        makeBtn(`Image (${imageRatio.name})`, imageExactRatio, "Image");

        // Divider
        const divider = document.createElement("span");
        divider.style.cssText = "color: #444; margin: 0 2px;";
        divider.textContent = "|";
        ratioBar.appendChild(divider);

        // Standard ratio buttons
        for (const [name, val] of Object.entries(STANDARD_RATIOS)) {
            makeBtn(name, val, name);
        }

        function updateButtonStates() {
            for (const [name, btn] of Object.entries(ratioButtons)) {
                if (name === activeRatioName) {
                    btn.style.background = "#4a9eff";
                    btn.style.color = "#fff";
                    btn.style.borderColor = "#4a9eff";
                } else {
                    btn.style.background = "#2a2a3e";
                    btn.style.color = "#aaa";
                    btn.style.borderColor = "#444";
                }
            }
        }
        updateButtonStates();

        // --- Crop state ---
        let crop = {
            x: xWidget.value || 0,
            y: yWidget.value || 0,
            w: wWidget.value || imgW,
            h: hWidget.value || imgH,
        };

        // Default: fit to image's own ratio (full image)
        if (crop.w === 512 && crop.h === 512 && imgW !== 512) {
            // First time — start with full image crop
            crop = { x: 0, y: 0, w: imgW, h: imgH };
        }

        if (lockedRatio !== null) {
            crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
        }
        clampCrop(crop, imgW, imgH);

        let dragMode = null;
        let dragStart = null;
        let dragCropStart = null;
        const HANDLE_SIZE = 8;

        function toDisplay(ix, iy) { return [ix * scale, iy * scale]; }
        function toImage(dx, dy) { return [dx / scale, dy / scale]; }

        function updateInfo() {
            const ratioStr = crop.w > 0 && crop.h > 0 ? (crop.w / crop.h).toFixed(3) : "—";
            const label = activeRatioName === "Free" ? "Freeform" :
                          activeRatioName === "Image" ? `Image (${imageRatio.name})` :
                          activeRatioName;
            infoLabel.textContent = `${label}  |  X:${Math.round(crop.x)} Y:${Math.round(crop.y)} ${Math.round(crop.w)}×${Math.round(crop.h)}  ratio:${ratioStr}`;
        }

        function draw() {
            ctx.clearRect(0, 0, dispW, dispH);
            ctx.drawImage(img, 0, 0, dispW, dispH);

            ctx.fillStyle = "rgba(0,0,0,0.55)";
            const [cx, cy] = toDisplay(crop.x, crop.y);
            const cw = crop.w * scale;
            const ch = crop.h * scale;

            ctx.fillRect(0, 0, dispW, cy);
            ctx.fillRect(0, cy + ch, dispW, dispH - cy - ch);
            ctx.fillRect(0, cy, cx, ch);
            ctx.fillRect(cx + cw, cy, dispW - cx - cw, ch);

            ctx.strokeStyle = "#4a9eff";
            ctx.lineWidth = 2;
            ctx.strokeRect(cx, cy, cw, ch);

            // Rule of thirds
            ctx.strokeStyle = "rgba(255,255,255,0.2)";
            ctx.lineWidth = 1;
            for (let i = 1; i <= 2; i++) {
                const lx = cx + (cw * i) / 3;
                const ly = cy + (ch * i) / 3;
                ctx.beginPath(); ctx.moveTo(lx, cy); ctx.lineTo(lx, cy + ch); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(cx, ly); ctx.lineTo(cx + cw, ly); ctx.stroke();
            }

            // Corner handles (always)
            ctx.fillStyle = "#4a9eff";
            const hs = HANDLE_SIZE;
            for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
                ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
            }

            // Edge handles (freeform only)
            if (lockedRatio === null) {
                for (const [hx, hy] of [[cx + cw/2, cy], [cx + cw/2, cy + ch], [cx, cy + ch/2], [cx + cw, cy + ch/2]]) {
                    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
                }
            }

            // Lock indicator
            if (lockedRatio !== null) {
                ctx.fillStyle = "rgba(74,158,255,0.9)";
                ctx.font = "bold 11px sans-serif";
                ctx.textBaseline = "top";
                ctx.textAlign = "left";
                ctx.fillText("🔒", cx + 5, cy + 4);
            }

            updateInfo();
        }

        function hitTest(mx, my) {
            const [cx, cy] = toDisplay(crop.x, crop.y);
            const cw = crop.w * scale;
            const ch = crop.h * scale;
            const hs = HANDLE_SIZE + 4;

            if (Math.abs(mx - cx) < hs && Math.abs(my - cy) < hs) return "resize-tl";
            if (Math.abs(mx - (cx + cw)) < hs && Math.abs(my - cy) < hs) return "resize-tr";
            if (Math.abs(mx - cx) < hs && Math.abs(my - (cy + ch)) < hs) return "resize-bl";
            if (Math.abs(mx - (cx + cw)) < hs && Math.abs(my - (cy + ch)) < hs) return "resize-br";

            if (lockedRatio === null) {
                if (Math.abs(my - cy) < hs && mx > cx + hs && mx < cx + cw - hs) return "resize-t";
                if (Math.abs(my - (cy + ch)) < hs && mx > cx + hs && mx < cx + cw - hs) return "resize-b";
                if (Math.abs(mx - cx) < hs && my > cy + hs && my < cy + ch - hs) return "resize-l";
                if (Math.abs(mx - (cx + cw)) < hs && my > cy + hs && my < cy + ch - hs) return "resize-r";
            }

            if (mx >= cx && mx <= cx + cw && my >= cy && my <= cy + ch) return "move";
            return "draw";
        }

        function getCursor(mode) {
            switch (mode) {
                case "resize-tl": case "resize-br": return "nwse-resize";
                case "resize-tr": case "resize-bl": return "nesw-resize";
                case "resize-t": case "resize-b": return "ns-resize";
                case "resize-l": case "resize-r": return "ew-resize";
                case "move": return "move";
                default: return "crosshair";
            }
        }

        function applyResize(mode, dx, dy) {
            const s = dragCropStart;

            if (mode === "move") {
                crop.x = s.x + dx;
                crop.y = s.y + dy;
                crop.w = s.w;
                crop.h = s.h;
                // Clamp position, keep size
                crop.x = Math.max(0, Math.min(crop.x, imgW - crop.w));
                crop.y = Math.max(0, Math.min(crop.y, imgH - crop.h));
            } else if (lockedRatio !== null) {
                applyRatioLockedResize(mode, dx, dy, s);
            } else {
                applyFreeResize(mode, dx, dy, s);
                if (crop.w < 0) { crop.x += crop.w; crop.w = Math.abs(crop.w); }
                if (crop.h < 0) { crop.y += crop.h; crop.h = Math.abs(crop.h); }
                clampCrop(crop, imgW, imgH);
            }
        }

        function applyFreeResize(mode, dx, dy, s) {
            if (mode === "draw") {
                const ix = Math.max(0, Math.min(dragStart[0] + dx, imgW));
                const iy = Math.max(0, Math.min(dragStart[1] + dy, imgH));
                crop.x = Math.min(dragStart[0], ix);
                crop.y = Math.min(dragStart[1], iy);
                crop.w = Math.abs(ix - dragStart[0]);
                crop.h = Math.abs(iy - dragStart[1]);
            } else if (mode === "resize-br") { crop.w = s.w + dx; crop.h = s.h + dy; }
            else if (mode === "resize-bl") { crop.x = s.x + dx; crop.w = s.w - dx; crop.h = s.h + dy; }
            else if (mode === "resize-tr") { crop.y = s.y + dy; crop.w = s.w + dx; crop.h = s.h - dy; }
            else if (mode === "resize-tl") { crop.x = s.x + dx; crop.y = s.y + dy; crop.w = s.w - dx; crop.h = s.h - dy; }
            else if (mode === "resize-t") { crop.y = s.y + dy; crop.h = s.h - dy; }
            else if (mode === "resize-b") { crop.h = s.h + dy; }
            else if (mode === "resize-l") { crop.x = s.x + dx; crop.w = s.w - dx; }
            else if (mode === "resize-r") { crop.w = s.w + dx; }
        }

        function applyRatioLockedResize(mode, dx, dy, s) {
            const R = lockedRatio;
            let newW, newH, newX, newY;

            if (mode === "draw") {
                newW = Math.max(20, Math.abs(dx));
                newH = newW / R;
                newX = dx > 0 ? dragStart[0] : dragStart[0] - newW;
                newY = dy > 0 ? dragStart[1] : dragStart[1] - newH;
            } else if (mode === "resize-br") {
                newW = Math.max(20, s.w + dx);
                newH = newW / R;
                newX = s.x;
                newY = s.y;
            } else if (mode === "resize-bl") {
                newW = Math.max(20, s.w - dx);
                newH = newW / R;
                newX = s.x + s.w - newW;
                newY = s.y;
            } else if (mode === "resize-tr") {
                newW = Math.max(20, s.w + dx);
                newH = newW / R;
                newX = s.x;
                newY = s.y + s.h - newH;
            } else if (mode === "resize-tl") {
                newW = Math.max(20, s.w - dx);
                newH = newW / R;
                newX = s.x + s.w - newW;
                newY = s.y + s.h - newH;
            }

            if (newW === undefined) return;

            // Constrain to image bounds while preserving ratio
            // Check each edge and shrink proportionally if needed
            if (newX < 0) {
                newW += newX; // shrink by overshoot
                newH = newW / R;
                newX = 0;
                // Recalc Y anchor for modes that anchor bottom/right
                if (mode === "resize-tl" || mode === "resize-tr") newY = s.y + s.h - newH;
            }
            if (newY < 0) {
                newH += newY;
                newW = newH * R;
                newY = 0;
                if (mode === "resize-tl" || mode === "resize-bl") newX = s.x + s.w - newW;
            }
            if (newX + newW > imgW) {
                newW = imgW - newX;
                newH = newW / R;
                if (mode === "resize-tl" || mode === "resize-tr") newY = s.y + s.h - newH;
            }
            if (newY + newH > imgH) {
                newH = imgH - newY;
                newW = newH * R;
                if (mode === "resize-tl" || mode === "resize-bl") newX = s.x + s.w - newW;
            }

            // Final safety: ensure minimum size
            newW = Math.max(20, newW);
            newH = Math.max(20, newW / R);

            crop.x = newX;
            crop.y = newY;
            crop.w = newW;
            crop.h = newH;
        }

        canvas.addEventListener("mousemove", (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            if (!dragMode) {
                canvas.style.cursor = getCursor(hitTest(mx, my));
                return;
            }

            const [ix, iy] = toImage(mx, my);
            applyResize(dragMode, ix - dragStart[0], iy - dragStart[1]);
            draw();
        });

        canvas.addEventListener("mousedown", (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const [ix, iy] = toImage(mx, my);

            dragMode = hitTest(mx, my);
            dragStart = [ix, iy];
            dragCropStart = { ...crop };

            if (dragMode === "draw") {
                crop.x = ix;
                crop.y = iy;
                crop.w = 1;
                crop.h = lockedRatio ? 1 / lockedRatio : 1;
            }
        });

        canvas.addEventListener("mouseup", () => {
            dragMode = null;
            if (lockedRatio === null) {
                clampCrop(crop, imgW, imgH);
            }
            draw();
        });

        const onKey = (e) => {
            if (e.key === "Escape") cleanup();
            else if (e.key === "Enter") applyCrop();
        };
        document.addEventListener("keydown", onKey);

        function cleanup() {
            document.removeEventListener("keydown", onKey);
            overlay.remove();
        }

        function applyCrop() {
            xWidget.value = Math.round(crop.x);
            yWidget.value = Math.round(crop.y);
            wWidget.value = Math.round(crop.w);
            hWidget.value = Math.round(crop.h);

            // Also update the ratio widget on the node if it exists
            const ratioWidget = node.widgets?.find(w => w.name === "ratio");
            if (ratioWidget) {
                if (activeRatioName === "Free") {
                    ratioWidget.value = "Freeform";
                } else if (activeRatioName === "Image") {
                    // Set to closest standard ratio or Freeform
                    ratioWidget.value = imageRatio.name;
                } else if (STANDARD_RATIOS[activeRatioName] !== undefined) {
                    ratioWidget.value = activeRatioName;
                }
            }

            app.graph.setDirtyCanvas(true);
            cleanup();
        }

        saveCropBtn.addEventListener("click", async () => {
            // Crop at full resolution using an offscreen canvas
            const cx = Math.round(crop.x);
            const cy = Math.round(crop.y);
            const cw = Math.round(crop.w);
            const ch = Math.round(crop.h);

            if (cw < 1 || ch < 1) { alert("Crop region too small."); return; }

            const offCanvas = document.createElement("canvas");
            offCanvas.width = cw;
            offCanvas.height = ch;
            const offCtx = offCanvas.getContext("2d");
            offCtx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);

            // Build filename: original_name_cropped.ext
            let saveName = "cropped.png";
            let saveExt = "png";
            if (sourceFilename) {
                const dotIdx = sourceFilename.lastIndexOf(".");
                const baseName = dotIdx > 0 ? sourceFilename.substring(0, dotIdx) : sourceFilename;
                const origExt = dotIdx > 0 ? sourceFilename.substring(dotIdx + 1).toLowerCase() : "png";
                saveExt = ["jpg", "jpeg", "png", "webp"].includes(origExt) ? origExt : "png";
                saveName = `${baseName}_cropped.${saveExt}`;
            }

            // Export to blob
            const mimeType = saveExt === "jpg" || saveExt === "jpeg" ? "image/jpeg" : `image/${saveExt}`;
            const quality = mimeType === "image/jpeg" ? 0.95 : undefined;

            saveCropBtn.textContent = "⏳ Saving…";

            try {
                const blob = await new Promise(resolve => offCanvas.toBlob(resolve, mimeType, quality));
                const formData = new FormData();
                formData.append("image", new File([blob], saveName, { type: mimeType }));
                formData.append("subfolder", sourceSubfolder || "");
                formData.append("type", "input");
                formData.append("overwrite", "true");

                const resp = await fetch("/upload/image", { method: "POST", body: formData });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const result = await resp.json();
                saveCropBtn.textContent = `✅ Saved: ${result.name}`;
                setTimeout(() => { saveCropBtn.textContent = "💾 Save Cropped"; }, 3000);
            } catch (e) {
                console.error("Save cropped failed:", e);
                saveCropBtn.textContent = "❌ Failed";
                setTimeout(() => { saveCropBtn.textContent = "💾 Save Cropped"; }, 3000);
            }
        });

        resetBtn.addEventListener("click", () => {
            // Reset to full image with current ratio
            crop = { x: 0, y: 0, w: imgW, h: imgH };
            if (lockedRatio !== null) {
                crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
            }
            draw();
        });
        applyBtn.addEventListener("click", applyCrop);
        cancelBtn.addEventListener("click", cleanup);

        draw();
    };

    img.onerror = () => {
        overlay.remove();
        alert("Failed to load the source image for crop editing.");
    };

    img.src = imgUrl;
}


function fitCropToRatio(crop, ratio, imgW, imgH) {
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;

    let newW = crop.w;
    let newH = newW / ratio;

    if (newH > crop.h) {
        newH = crop.h;
        newW = newH * ratio;
    }

    // Ensure it fits within image bounds
    if (newW > imgW) { newW = imgW; newH = newW / ratio; }
    if (newH > imgH) { newH = imgH; newW = newH * ratio; }

    return {
        x: Math.max(0, Math.min(cx - newW / 2, imgW - newW)),
        y: Math.max(0, Math.min(cy - newH / 2, imgH - newH)),
        w: newW,
        h: newH,
    };
}


function clampCrop(crop, imgW, imgH) {
    crop.x = Math.max(0, Math.min(crop.x, imgW - 1));
    crop.y = Math.max(0, Math.min(crop.y, imgH - 1));
    crop.w = Math.max(1, Math.min(crop.w, imgW - crop.x));
    crop.h = Math.max(1, Math.min(crop.h, imgH - crop.y));
}
