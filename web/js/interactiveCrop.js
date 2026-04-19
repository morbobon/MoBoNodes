import { app } from "../../scripts/app.js";
import { openCropEditor } from "./cropEditor.js";

app.registerExtension({
    name: "mobo.InteractiveCrop",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "InteractiveCrop") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            const node = this;
            const xWidget = node.widgets.find(w => w.name === "crop_x");
            const yWidget = node.widgets.find(w => w.name === "crop_y");
            const wWidget = node.widgets.find(w => w.name === "crop_width");
            const hWidget = node.widgets.find(w => w.name === "crop_height");
            if (!xWidget || !yWidget || !wWidget || !hWidget) return;

            node.addWidget("button", "🖼 Show & Edit Image", null, () => {
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
