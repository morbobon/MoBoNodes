import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "mobo.FolderImageLoader",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "MoBo_LoadImageFromFolder" && nodeData.name !== "MoBo_FolderImageLoader" && nodeData.name !== "FolderImageLoader") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            const node = this;
            const subfolderWidget = node.widgets.find(w => w.name === "subfolder");
            const imageWidget    = node.widgets.find(w => w.name === "image");
            if (!subfolderWidget || !imageWidget) return;

            // --- Image preview -------------------------------------------------

            const updatePreview = (subfolder, filename) => {
                if (!filename || filename === "none") {
                    node.imgs = undefined;
                    app.graph.setDirtyCanvas(true);
                    return;
                }

                const sub = (subfolder === ".") ? "" : subfolder;
                const url = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(sub)}&type=input&rand=${Math.random()}`;

                const img = new Image();
                img.onload = () => {
                    node.imgs = [img];
                    const imgH = Math.min(img.naturalHeight * (node.size[0] / img.naturalWidth), 500);
                    node.size[1] = node.computeSize()[1] + imgH + 10;
                    app.graph.setDirtyCanvas(true);
                };
                img.onerror = () => {
                    node.imgs = undefined;
                    app.graph.setDirtyCanvas(true);
                };
                img.src = url;
            };

            // --- Subfolder refresh ---------------------------------------------

            const refreshSubfolders = async () => {
                try {
                    const resp = await fetch("/mobo_nodes/image_loader/subfolders");
                    const folders = await resp.json();
                    if (folders.length > 0) {
                        Object.defineProperty(subfolderWidget.options, "values", {
                            get() { return folders; },
                            configurable: true,
                        });
                    }
                } catch (e) {
                    console.error("MoBo FolderImageLoader: failed to fetch subfolders", e);
                }
            };

            // --- Image list refresh --------------------------------------------

            const refreshImages = async (subfolder, selectFilename = null) => {
                try {
                    const resp = await fetch(
                        `/mobo_nodes/image_loader/images?subfolder=${encodeURIComponent(subfolder)}`
                    );
                    const images = await resp.json();
                    const list = images.length > 0 ? images : ["none"];

                    Object.defineProperty(imageWidget.options, "values", {
                        get() { return list; },
                        configurable: true,
                    });

                    // Select the requested filename if it exists, otherwise first
                    imageWidget.value = (selectFilename && list.includes(selectFilename))
                        ? selectFilename
                        : list[0];

                    updatePreview(subfolder, imageWidget.value);
                } catch (e) {
                    console.error("MoBo FolderImageLoader: failed to fetch images", e);
                }
            };

            // --- Upload --------------------------------------------------------

            const uploadButton = node.addWidget("button", "📁 Upload Image", null, () => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "image/*";
                input.multiple = true;

                input.onchange = async () => {
                    const files = Array.from(input.files);
                    if (!files.length) return;

                    uploadButton.name = "⏳ Uploading…";
                    app.graph.setDirtyCanvas(true);

                    let lastFilename = null;
                    for (const file of files) {
                        try {
                            const subfolder = subfolderWidget.value === "." ? "" : subfolderWidget.value;
                            const formData = new FormData();
                            formData.append("image", file);
                            formData.append("subfolder", subfolder);
                            formData.append("type", "input");
                            formData.append("overwrite", "false");

                            const resp = await fetch("/upload/image", {
                                method: "POST",
                                body: formData,
                            });

                            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                            const result = await resp.json();
                            lastFilename = result.name;
                        } catch (e) {
                            console.error("MoBo FolderImageLoader: upload failed for", file.name, e);
                        }
                    }

                    uploadButton.name = "📁 Upload Image";
                    await refreshImages(subfolderWidget.value, lastFilename);
                    app.graph.setDirtyCanvas(true);
                };

                input.click();
            });

            // Also support drag-and-drop onto the node
            const origOnDragOver = node.onDragOver;
            node.onDragOver = (e) => {
                if (e.dataTransfer?.types?.includes("Files")) {
                    e.preventDefault();
                    return true;
                }
                return origOnDragOver?.call(node, e);
            };

            const origOnDragDrop = node.onDragDrop;
            node.onDragDrop = async (e) => {
                const files = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith("image/"));
                if (!files.length) return origOnDragDrop?.call(node, e) ?? false;

                uploadButton.name = "⏳ Uploading…";
                app.graph.setDirtyCanvas(true);

                let lastFilename = null;
                for (const file of files) {
                    try {
                        const subfolder = subfolderWidget.value === "." ? "" : subfolderWidget.value;
                        const formData = new FormData();
                        formData.append("image", file);
                        formData.append("subfolder", subfolder);
                        formData.append("type", "input");
                        formData.append("overwrite", "false");

                        const resp = await fetch("/upload/image", { method: "POST", body: formData });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        const result = await resp.json();
                        lastFilename = result.name;
                    } catch (e) {
                        console.error("MoBo FolderImageLoader: drag-drop upload failed", e);
                    }
                }

                uploadButton.name = "📁 Upload Image";
                await refreshImages(subfolderWidget.value, lastFilename);
                app.graph.setDirtyCanvas(true);
                return true;
            };

            // --- Widget callbacks ----------------------------------------------

            const origSubfolderCallback = subfolderWidget.callback;
            subfolderWidget.callback = async (value) => {
                origSubfolderCallback?.call(node, value);
                await refreshImages(value);
            };

            const origImageCallback = imageWidget.callback;
            imageWidget.callback = (value) => {
                origImageCallback?.call(node, value);
                updatePreview(subfolderWidget.value, value);
            };

            // --- onConfigure: runs after widget values are restored from saved workflow ---
            // Use this instead of onNodeCreated for the initial population so that
            // saved subfolder/image selections are preserved rather than reset to defaults.

            const origOnConfigure = node.onConfigure;
            node.onConfigure = function (info) {
                origOnConfigure?.call(node, info);

                const savedSubfolder = subfolderWidget.value;
                const savedImage     = imageWidget.value;

                (async () => {
                    await refreshSubfolders();
                    // Restore saved subfolder (it may not be in the default options list yet)
                    subfolderWidget.value = savedSubfolder;
                    // Populate images for the saved subfolder, re-selecting the saved image
                    await refreshImages(savedSubfolder, savedImage);
                })();
            };
        };
    },
});
