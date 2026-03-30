import { app } from "../../scripts/app.js";

// Same ratio logic as the Python side
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

const INFO_PANEL_HEIGHT = 120;
const PANEL_PADDING = 12;

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

            // Toggle button widget
            node.addWidget("button", "ℹ️ Show Info", null, () => {
                node._moboShowInfo = !node._moboShowInfo;
                toggleWidget.name = node._moboShowInfo ? "ℹ️ Hide Info" : "ℹ️ Show Info";
                resizeNode();
                app.graph.setDirtyCanvas(true);
            });
            const toggleWidget = node.widgets[node.widgets.length - 1];
            toggleWidget.name = "ℹ️ Hide Info"; // default is shown
            toggleWidget.serialize = false;

            function resolveImageUrl() {
                const imageInput = node.inputs?.find(i => i.name === "image");
                if (!imageInput || !imageInput.link) return null;

                const linkInfo = app.graph.links[imageInput.link];
                if (!linkInfo) return null;
                const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                if (!sourceNode) return null;

                if (sourceNode.imgs && sourceNode.imgs.length > 0) {
                    return sourceNode.imgs[0].src;
                }

                const imgWidget = sourceNode.widgets?.find(w => w.name === "image");
                if (imgWidget && imgWidget.value) {
                    const subWidget = sourceNode.widgets?.find(w => w.name === "subfolder");
                    const sub = subWidget ? (subWidget.value === "." ? "" : subWidget.value) : "";
                    return `/view?filename=${encodeURIComponent(imgWidget.value)}&subfolder=${encodeURIComponent(sub)}&type=input`;
                }

                return null;
            }

            function resizeNode() {
                // Compute base height from LiteGraph (slots + title + widgets)
                const slotsH = LiteGraph.NODE_SLOT_HEIGHT * Math.max(node.inputs?.length || 0, node.outputs?.length || 0);
                const widgetsH = (node.widgets?.length || 0) * (LiteGraph.NODE_WIDGET_HEIGHT + 4) + 4;
                const baseH = Math.max(slotsH, widgetsH) + 30;
                const panelH = node._moboShowInfo ? INFO_PANEL_HEIGHT + PANEL_PADDING : 0;
                node.size[1] = baseH + panelH;
                node.setDirtyCanvas(true, true);
            }

            function updateInfo() {
                if (!node._moboShowInfo) return;

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
                    resizeNode();
                    app.graph.setDirtyCanvas(true);
                };
                img.onerror = () => {
                    node._moboInfoLines = ["Failed to load image preview"];
                    app.graph.setDirtyCanvas(true);
                };
                img.src = imgUrl;
            }

            // Draw the info panel at the bottom of the node
            const origOnDrawForeground = node.onDrawForeground;
            node.onDrawForeground = function (ctx) {
                origOnDrawForeground?.call(this, ctx);

                if (!node._moboShowInfo || !node._moboInfoLines) return;

                const panelW = node.size[0];
                const panelY = node.size[1] - INFO_PANEL_HEIGHT - 6;

                // Background
                ctx.fillStyle = "#1a1a2e";
                ctx.beginPath();
                ctx.roundRect(6, panelY, panelW - 12, INFO_PANEL_HEIGHT, 6);
                ctx.fill();

                // Border
                ctx.strokeStyle = "#333";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(6, panelY, panelW - 12, INFO_PANEL_HEIGHT, 6);
                ctx.stroke();

                // Text
                ctx.fillStyle = "#ccddee";
                ctx.font = "12px monospace";
                ctx.textBaseline = "top";
                const lineH = 17;
                const textX = 16;
                const textY = panelY + 10;

                for (let i = 0; i < node._moboInfoLines.length; i++) {
                    ctx.fillText(node._moboInfoLines[i], textX, textY + i * lineH);
                }
            };

            // Poll for source changes
            const pollTimer = setInterval(() => {
                node._moboLastSrc = null;
                updateInfo();
            }, 2000);

            // Update on connection change
            const origOnConnectionsChange = node.onConnectionsChange;
            node.onConnectionsChange = function () {
                origOnConnectionsChange?.apply(node, arguments);
                node._moboLastSrc = null;
                updateInfo();
            };

            // Cleanup
            const origOnRemoved = node.onRemoved;
            node.onRemoved = function () {
                clearInterval(pollTimer);
                origOnRemoved?.call(node);
            };

            // Configure (workflow load)
            const origOnConfigure = node.onConfigure;
            node.onConfigure = function (info) {
                origOnConfigure?.call(node, info);
                setTimeout(() => { resizeNode(); updateInfo(); }, 500);
            };

            // Initial
            setTimeout(() => { resizeNode(); updateInfo(); }, 300);
        };
    },
});
