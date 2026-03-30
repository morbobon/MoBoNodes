import { app } from "../../scripts/app.js";

const RATIO_MAP = {
    "1:1": 1/1, "4:3": 4/3, "3:4": 3/4, "5:4": 5/4, "4:5": 4/5,
    "3:2": 3/2, "2:3": 2/3, "16:9": 16/9, "9:16": 9/16,
    "16:10": 16/10, "10:16": 10/16, "21:9": 21/9, "9:21": 9/21,
    "2:1": 2/1, "1:2": 1/2,
};

function parseRatioString(str) {
    if (!str || str === "Freeform") return null;
    if (RATIO_MAP[str] !== undefined) return RATIO_MAP[str];
    const m = str.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
    if (m) return parseFloat(m[1]) / parseFloat(m[2]);
    return null;
}

app.registerExtension({
    name: "mobo.InteractiveCrop",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "MoBo_InteractiveCrop") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            const node = this;
            const ratioWidget = node.widgets.find(w => w.name === "ratio");
            const xWidget = node.widgets.find(w => w.name === "crop_x");
            const yWidget = node.widgets.find(w => w.name === "crop_y");
            const wWidget = node.widgets.find(w => w.name === "crop_width");
            const hWidget = node.widgets.find(w => w.name === "crop_height");
            const customWWidget = node.widgets.find(w => w.name === "custom_ratio_w");
            const customHWidget = node.widgets.find(w => w.name === "custom_ratio_h");
            if (!xWidget || !yWidget || !wWidget || !hWidget) return;

            // Resolve the active ratio from widget, custom values, or override input
            function getActiveRatio() {
                // Check for ratio_override input (from Aspect Ratio node)
                const overrideInput = node.inputs?.find(i => i.name === "ratio_override");
                if (overrideInput && overrideInput.link) {
                    // We can't read the value at edit time, but the widget stores the last value
                    // The override is used at execution time; at edit time, fall back to dropdown
                }

                const sel = ratioWidget?.value || "Freeform";
                if (sel === "Freeform") return null;
                if (sel === "Custom") {
                    const cw = customWWidget?.value || 16;
                    const ch = customHWidget?.value || 9;
                    return cw / ch;
                }
                return parseRatioString(sel);
            }

            // "Select Crop Region" button
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
                if (sourceNode.imgs && sourceNode.imgs.length > 0) {
                    imgUrl = sourceNode.imgs[0].src;
                }
                if (!imgUrl) {
                    const imgWidget = sourceNode.widgets?.find(w => w.name === "image");
                    if (imgWidget && imgWidget.value) {
                        const subWidget = sourceNode.widgets?.find(w => w.name === "subfolder");
                        const sub = subWidget ? (subWidget.value === "." ? "" : subWidget.value) : "";
                        imgUrl = `/view?filename=${encodeURIComponent(imgWidget.value)}&subfolder=${encodeURIComponent(sub)}&type=input`;
                    }
                }
                if (!imgUrl) {
                    alert("Cannot preview the source image. Run the workflow once first, or connect to a Load Image node.");
                    return;
                }

                const lockedRatio = getActiveRatio();
                openCropEditor(imgUrl, xWidget, yWidget, wWidget, hWidget, node, lockedRatio);
            });
        };
    },
});


function openCropEditor(imgUrl, xWidget, yWidget, wWidget, hWidget, node, lockedRatio) {
    // Create fullscreen overlay
    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.85); z-index: 100000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #fff;
    `;
    document.body.appendChild(overlay);

    // Header bar
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex; align-items: center; gap: 16px; padding: 12px 20px;
        background: #1a1a2e; border-radius: 8px; margin-bottom: 12px; flex-wrap: wrap;
    `;
    overlay.appendChild(header);

    const title = document.createElement("span");
    title.style.cssText = "font-size: 14px; opacity: 0.8;";
    title.textContent = lockedRatio
        ? `Ratio locked: ${lockedRatio.toFixed(3)}`
        : "Freeform crop";
    header.appendChild(title);

    const infoLabel = document.createElement("span");
    infoLabel.style.cssText = "font-size: 13px; font-family: monospace; color: #66ccff; min-width: 320px;";
    header.appendChild(infoLabel);

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.style.cssText = `
        padding: 8px 24px; background: #4a9eff; color: #fff; border: none;
        border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;
    `;
    header.appendChild(applyBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = `
        padding: 8px 16px; background: #555; color: #fff; border: none;
        border-radius: 6px; cursor: pointer; font-size: 14px;
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
        const maxW = window.innerWidth - 60;
        const maxH = window.innerHeight - 120;
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);

        const dispW = Math.floor(img.naturalWidth * scale);
        const dispH = Math.floor(img.naturalHeight * scale);
        canvas.width = dispW;
        canvas.height = dispH;

        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;

        // Current crop rect in image coordinates
        let crop = {
            x: xWidget.value || 0,
            y: yWidget.value || 0,
            w: wWidget.value || Math.floor(imgW / 2),
            h: hWidget.value || Math.floor(imgH / 2),
        };

        // If ratio locked, adjust initial crop to match ratio
        if (lockedRatio) {
            crop = fitCropToRatio(crop, lockedRatio, imgW, imgH);
        }

        // Clamp initial values
        clampCrop(crop, imgW, imgH);

        let dragMode = null;
        let dragStart = null;
        let dragCropStart = null;
        const HANDLE_SIZE = 8;

        function toDisplay(ix, iy) { return [ix * scale, iy * scale]; }
        function toImage(dx, dy) { return [dx / scale, dy / scale]; }

        function updateInfo() {
            const ratioStr = crop.w > 0 && crop.h > 0 ? (crop.w / crop.h).toFixed(3) : "—";
            infoLabel.textContent = `X: ${Math.round(crop.x)}  Y: ${Math.round(crop.y)}  W: ${Math.round(crop.w)}  H: ${Math.round(crop.h)}  Ratio: ${ratioStr}`;
        }

        function draw() {
            ctx.clearRect(0, 0, dispW, dispH);
            ctx.drawImage(img, 0, 0, dispW, dispH);

            // Dim outside
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            const [cx, cy] = toDisplay(crop.x, crop.y);
            const cw = crop.w * scale;
            const ch = crop.h * scale;

            ctx.fillRect(0, 0, dispW, cy);
            ctx.fillRect(0, cy + ch, dispW, dispH - cy - ch);
            ctx.fillRect(0, cy, cx, ch);
            ctx.fillRect(cx + cw, cy, dispW - cx - cw, ch);

            // Crop border
            ctx.strokeStyle = "#4a9eff";
            ctx.lineWidth = 2;
            ctx.strokeRect(cx, cy, cw, ch);

            // Rule of thirds
            ctx.strokeStyle = "rgba(255,255,255,0.25)";
            ctx.lineWidth = 1;
            for (let i = 1; i <= 2; i++) {
                const lx = cx + (cw * i) / 3;
                const ly = cy + (ch * i) / 3;
                ctx.beginPath(); ctx.moveTo(lx, cy); ctx.lineTo(lx, cy + ch); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(cx, ly); ctx.lineTo(cx + cw, ly); ctx.stroke();
            }

            // Corner handles
            ctx.fillStyle = "#4a9eff";
            const hs = HANDLE_SIZE;
            for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
                ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
            }

            // Edge handles (only when freeform — they don't make sense with ratio lock)
            if (!lockedRatio) {
                for (const [hx, hy] of [[cx + cw/2, cy], [cx + cw/2, cy + ch], [cx, cy + ch/2], [cx + cw, cy + ch/2]]) {
                    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
                }
            }

            // Ratio lock indicator
            if (lockedRatio) {
                ctx.fillStyle = "rgba(74, 158, 255, 0.8)";
                ctx.font = "bold 11px sans-serif";
                ctx.fillText("🔒", cx + 6, cy + 16);
            }

            updateInfo();
        }

        function hitTest(mx, my) {
            const [cx, cy] = toDisplay(crop.x, crop.y);
            const cw = crop.w * scale;
            const ch = crop.h * scale;
            const hs = HANDLE_SIZE + 4;

            // Corner handles (always available)
            if (Math.abs(mx - cx) < hs && Math.abs(my - cy) < hs) return "resize-tl";
            if (Math.abs(mx - (cx + cw)) < hs && Math.abs(my - cy) < hs) return "resize-tr";
            if (Math.abs(mx - cx) < hs && Math.abs(my - (cy + ch)) < hs) return "resize-bl";
            if (Math.abs(mx - (cx + cw)) < hs && Math.abs(my - (cy + ch)) < hs) return "resize-br";

            // Edge handles (freeform only)
            if (!lockedRatio) {
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

        // --- Ratio-aware resize logic ---

        function applyResize(mode, dx, dy) {
            const s = dragCropStart;

            if (lockedRatio) {
                // For ratio-locked resize, use the dominant axis to compute both dimensions
                applyRatioLockedResize(mode, dx, dy, s, imgW, imgH);
            } else {
                applyFreeResize(mode, dx, dy, s);
            }

            if (crop.w < 0) { crop.x += crop.w; crop.w = Math.abs(crop.w); }
            if (crop.h < 0) { crop.y += crop.h; crop.h = Math.abs(crop.h); }
            clampCrop(crop, imgW, imgH);
        }

        function applyFreeResize(mode, dx, dy, s) {
            if (mode === "draw") {
                const ix = dragStart[0] + dx;
                const iy = dragStart[1] + dy;
                crop.x = Math.min(dragStart[0], ix);
                crop.y = Math.min(dragStart[1], iy);
                crop.w = Math.abs(ix - dragStart[0]);
                crop.h = Math.abs(iy - dragStart[1]);
            } else if (mode === "move") {
                crop.x = s.x + dx; crop.y = s.y + dy;
            } else if (mode === "resize-br") { crop.w = s.w + dx; crop.h = s.h + dy; }
            else if (mode === "resize-bl") { crop.x = s.x + dx; crop.w = s.w - dx; crop.h = s.h + dy; }
            else if (mode === "resize-tr") { crop.y = s.y + dy; crop.w = s.w + dx; crop.h = s.h - dy; }
            else if (mode === "resize-tl") { crop.x = s.x + dx; crop.y = s.y + dy; crop.w = s.w - dx; crop.h = s.h - dy; }
            else if (mode === "resize-t") { crop.y = s.y + dy; crop.h = s.h - dy; }
            else if (mode === "resize-b") { crop.h = s.h + dy; }
            else if (mode === "resize-l") { crop.x = s.x + dx; crop.w = s.w - dx; }
            else if (mode === "resize-r") { crop.w = s.w + dx; }
        }

        function applyRatioLockedResize(mode, dx, dy, s, imgW, imgH) {
            const R = lockedRatio;

            if (mode === "draw") {
                // Use width as driver, compute height from ratio
                const ix = dragStart[0] + dx;
                const iy = dragStart[1] + dy;
                let newW = Math.abs(ix - dragStart[0]);
                let newH = newW / R;
                crop.x = Math.min(dragStart[0], dragStart[0] + (ix > dragStart[0] ? 0 : -newW));
                crop.y = Math.min(dragStart[1], dragStart[1] + (iy > dragStart[1] ? 0 : -newH));
                crop.w = newW;
                crop.h = newH;
            } else if (mode === "move") {
                crop.x = s.x + dx;
                crop.y = s.y + dy;
                crop.w = s.w;
                crop.h = s.h;
            } else {
                // Corner resize: use the larger delta as driver
                let newW, newH;
                if (mode === "resize-br") {
                    newW = s.w + dx; newH = newW / R;
                } else if (mode === "resize-bl") {
                    newW = s.w - dx; newH = newW / R;
                    crop.x = s.x + s.w - newW;
                } else if (mode === "resize-tr") {
                    newW = s.w + dx; newH = newW / R;
                    crop.y = s.y + s.h - newH;
                } else if (mode === "resize-tl") {
                    newW = s.w - dx; newH = newW / R;
                    crop.x = s.x + s.w - newW;
                    crop.y = s.y + s.h - newH;
                }
                if (newW !== undefined) {
                    crop.w = Math.max(10, newW);
                    crop.h = Math.max(10, crop.w / R);
                }
            }
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
            const dx = ix - dragStart[0];
            const dy = iy - dragStart[1];

            applyResize(dragMode, dx, dy);
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
            clampCrop(crop, imgW, imgH);
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
            app.graph.setDirtyCanvas(true);
            cleanup();
        }

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
    // Adjust the crop to match the target ratio, keeping it centered
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;

    let newW = crop.w;
    let newH = newW / ratio;

    if (newH > crop.h) {
        newH = crop.h;
        newW = newH * ratio;
    }

    return {
        x: cx - newW / 2,
        y: cy - newH / 2,
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
