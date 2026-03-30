import { app } from "../../scripts/app.js";

const STANDARD_RATIOS = [
    [1, 1], [4, 3], [3, 4], [5, 4], [4, 5],
    [3, 2], [2, 3], [16, 9], [9, 16],
    [16, 10], [10, 16], [21, 9], [9, 21],
    [2, 1], [1, 2],
];

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

function findClosestRatio(w, h) {
    if (h === 0) return "N/A";
    const actual = w / h;
    let best = "N/A", bestDiff = Infinity;
    for (const [rw, rh] of STANDARD_RATIOS) {
        const diff = Math.abs(actual - rw / rh);
        if (diff < bestDiff) { bestDiff = diff; best = `${rw}:${rh}`; }
    }
    return best;
}

function exactRatio(w, h) {
    if (h === 0) return "N/A";
    const g = gcd(w, h);
    return `${w / g}:${h / g}`;
}

const INFO_PANEL_HEIGHT = 126;
const TOGGLE_BTN_HEIGHT = 26;
const TOGGLE_BTN_MARGIN = 6;
const BOTTOM_PADDING = 8;

app.registerExtension({
    name: "mobo.ImageInfo",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "MoBo_ImageInfo") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            const node = this;

            // State
            node._moboInfoLines = ["Connect an image to see info"];
            node._moboLastSrc = null;
            node._moboShowInfo = true;

            function resolveImageUrl() {
                // Walk the input chain to find an image preview URL
                const visited = new Set();
                let currentNode = node;

                while (currentNode) {
                    if (visited.has(currentNode.id)) break;
                    visited.add(currentNode.id);

                    const imageInput = currentNode.inputs?.find(i =>
                        i.name === "image" || i.type === "IMAGE"
                    );
                    if (!imageInput || !imageInput.link) break;

                    const linkInfo = app.graph.links[imageInput.link];
                    if (!linkInfo) break;
                    const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                    if (!sourceNode) break;

                    // Check if this source has a preview
                    if (sourceNode.imgs && sourceNode.imgs.length > 0) {
                        return sourceNode.imgs[0].src;
                    }

                    // Check if it's a LoadImage-style node
                    const imgWidget = sourceNode.widgets?.find(w => w.name === "image");
                    if (imgWidget && imgWidget.value) {
                        const subWidget = sourceNode.widgets?.find(w => w.name === "subfolder");
                        const sub = subWidget ? (subWidget.value === "." ? "" : subWidget.value) : "";
                        return `/view?filename=${encodeURIComponent(imgWidget.value)}&subfolder=${encodeURIComponent(sub)}&type=input`;
                    }

                    // Walk upstream
                    currentNode = sourceNode;
                }

                return null;
            }

            // Compute where the slots/widgets end (the "base" area)
            function getBaseBottom() {
                const baseSize = node.computeSize();
                return baseSize[1];
            }

            function getTargetHeight() {
                const base = getBaseBottom();
                let h = base + TOGGLE_BTN_HEIGHT + TOGGLE_BTN_MARGIN * 2;
                if (node._moboShowInfo) {
                    h += INFO_PANEL_HEIGHT + TOGGLE_BTN_MARGIN;
                }
                return h + BOTTOM_PADDING;
            }

            function updateInfo() {
                const imgUrl = resolveImageUrl();

                if (!imgUrl) {
                    const imageInput = node.inputs?.find(i => i.name === "image");
                    node._moboInfoLines = [!imageInput?.link
                        ? "Connect an image to see info"
                        : "Run workflow once to see info"
                    ];
                    node._moboLastSrc = null;
                    app.graph.setDirtyCanvas(true);
                    return;
                }

                if (imgUrl === node._moboLastSrc) return;
                node._moboLastSrc = imgUrl;

                const img = new Image();
                img.onload = () => {
                    const w = img.naturalWidth;
                    const h = img.naturalHeight;
                    node._moboInfoLines = [
                        `Size:         ${w} x ${h}`,
                        `Megapixels:   ${((w * h) / 1_000_000).toFixed(2)} MP`,
                        `Orientation:  ${w > h ? "landscape" : h > w ? "portrait" : "square"}`,
                        `Ratio:        ${(w / h).toFixed(4)}`,
                        `Closest:      ${findClosestRatio(w, h)}`,
                        `Exact:        ${exactRatio(w, h)}`,
                    ];
                    app.graph.setDirtyCanvas(true);
                };
                img.onerror = () => {
                    node._moboInfoLines = ["Failed to load image preview"];
                    app.graph.setDirtyCanvas(true);
                };
                img.src = imgUrl;
            }

            // --- Draw everything below the slots ---
            const origOnDrawForeground = node.onDrawForeground;
            node.onDrawForeground = function (ctx) {
                origOnDrawForeground?.call(this, ctx);

                // Enforce correct height
                const target = getTargetHeight();
                if (Math.abs(node.size[1] - target) > 1) {
                    node.size[1] = target;
                }

                const nodeW = node.size[0];
                const baseY = getBaseBottom();

                // --- Toggle button (drawn, not a widget) ---
                const btnX = 10;
                const btnY = baseY + TOGGLE_BTN_MARGIN;
                const btnW = nodeW - 20;
                const btnH = TOGGLE_BTN_HEIGHT;

                // Store for hit testing
                node._moboBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };

                // Button background
                ctx.fillStyle = "#2a2a3e";
                ctx.beginPath();
                ctx.roundRect(btnX, btnY, btnW, btnH, 4);
                ctx.fill();
                ctx.strokeStyle = "#444";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(btnX, btnY, btnW, btnH, 4);
                ctx.stroke();

                // Button text
                ctx.fillStyle = "#aabbcc";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(
                    node._moboShowInfo ? "ℹ️ Hide Info" : "ℹ️ Show Info",
                    btnX + btnW / 2,
                    btnY + btnH / 2
                );
                ctx.textAlign = "left"; // reset

                // --- Info panel ---
                if (!node._moboShowInfo || !node._moboInfoLines) return;

                const panelY = btnY + btnH + TOGGLE_BTN_MARGIN;
                const panelW = nodeW;

                ctx.fillStyle = "#1a1a2e";
                ctx.beginPath();
                ctx.roundRect(6, panelY, panelW - 12, INFO_PANEL_HEIGHT, 6);
                ctx.fill();

                ctx.strokeStyle = "#333";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(6, panelY, panelW - 12, INFO_PANEL_HEIGHT, 6);
                ctx.stroke();

                ctx.fillStyle = "#ccddee";
                ctx.font = "12px monospace";
                ctx.textBaseline = "top";
                const lineH = 18;
                const textX = 16;
                const textY = panelY + 10;

                for (let i = 0; i < node._moboInfoLines.length; i++) {
                    ctx.fillText(node._moboInfoLines[i], textX, textY + i * lineH);
                }
            };

            // Handle clicks on our drawn button
            const origOnMouseDown = node.onMouseDown;
            node.onMouseDown = function (e, localPos) {
                if (node._moboBtnRect) {
                    const r = node._moboBtnRect;
                    if (localPos[0] >= r.x && localPos[0] <= r.x + r.w &&
                        localPos[1] >= r.y && localPos[1] <= r.y + r.h) {
                        node._moboShowInfo = !node._moboShowInfo;
                        app.graph.setDirtyCanvas(true);
                        return true; // consume the event
                    }
                }
                return origOnMouseDown?.call(node, e, localPos);
            };

            // Poll for source changes
            const pollTimer = setInterval(() => {
                node._moboLastSrc = null;
                updateInfo();
            }, 2000);

            const origOnConnectionsChange = node.onConnectionsChange;
            node.onConnectionsChange = function () {
                origOnConnectionsChange?.apply(node, arguments);
                node._moboLastSrc = null;
                updateInfo();
            };

            const origOnRemoved = node.onRemoved;
            node.onRemoved = function () {
                clearInterval(pollTimer);
                origOnRemoved?.call(node);
            };

            const origOnConfigure = node.onConfigure;
            node.onConfigure = function (info) {
                origOnConfigure?.call(node, info);
                setTimeout(updateInfo, 500);
            };

            setTimeout(updateInfo, 300);
        };
    },
});
