# MoBo Nodes

Custom utility nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI). Focused on image handling, aspect ratio management, and cropping — filling gaps not covered by built-in nodes.

**Zero dependencies** — uses only standard ComfyUI types (IMAGE, MASK, INT, FLOAT, STRING). No external node packs required.

## Installation

### Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/morbobon/MoBoNodes.git
```

Restart ComfyUI. All nodes appear under the **MoBo Nodes** category.

## Nodes

### Load Image from Folder

Browse and load images by folder — unlike the built-in Load Image node which dumps all input images into a single flat list.

| | |
|---|---|
| **Inputs** | `subfolder` (dropdown), `image` (dropdown) |
| **Outputs** | `image` (IMAGE), `mask` (MASK), `folder` (STRING), `filename` (STRING) |

**Features:**
- **Folder browser** — dropdown lists all subfolders under ComfyUI's `input/` directory, including nested folders
- **Dynamic image list** — selecting a folder instantly populates the image dropdown with only the images in that folder
- **Image preview** — selected image renders directly on the node tile
- **Upload** — `Upload Image` button or drag-and-drop files onto the node; uploads go into the currently selected subfolder
- **Workflow persistence** — saved folder/image selections restore correctly when reopening a workflow

The `folder` output returns the relative subfolder name (e.g. `"photos/vacation"`), and `filename` returns just the filename (e.g. `"IMG_001.jpg"`).

---

### Image Info

Displays comprehensive image metadata at edit time — no need to run the workflow first.

| | |
|---|---|
| **Inputs** | `image` (IMAGE) |
| **Outputs** | `width` (INT), `height` (INT), `ratio_float` (FLOAT), `closest_ratio` (STRING), `exact_ratio` (STRING), `orientation` (STRING), `megapixels` (FLOAT) |

**Features:**
- **Live info panel** drawn directly on the node showing all values
- **Smart ratio detection** — `closest_ratio` finds the nearest standard ratio (e.g. reports `"16:9"` for a 1920x1074 image, not `"320:179"`)
- **Exact ratio** — GCD-reduced ratio for precise values
- **Toggle button** — show/hide the info panel to save canvas space

Supported standard ratios: 1:1, 4:3, 3:4, 5:4, 4:5, 3:2, 2:3, 16:9, 9:16, 16:10, 10:16, 21:9, 9:21, 2:1, 1:2

---

### Aspect Ratio

Select or auto-detect an aspect ratio and compute a concrete pixel resolution. Feed the width/height outputs directly into Empty Latent Image or ImageScale.

| | |
|---|---|
| **Required inputs** | `ratio` (dropdown), `target_longest_side` (INT), `divisible_by` (INT) |
| **Optional inputs** | `image` (IMAGE), `auto_snap` (BOOLEAN), `custom_ratio_w` (INT), `custom_ratio_h` (INT) |
| **Outputs** | `ratio_string` (STRING), `width` (INT), `height` (INT), `ratio_float` (FLOAT) |

**Features:**
- **Standard ratio presets** — 1:1, 4:3, 3:4, 5:4, 4:5, 3:2, 2:3, 16:9, 9:16, 16:10, 10:16, 21:9, 9:21, 2:1, 1:2, plus Custom
- **Auto-snap** — connect an image and enable `auto_snap` to automatically detect and snap to the nearest standard ratio
- **Custom ratio** — set `ratio` to "Custom" and use `custom_ratio_w` / `custom_ratio_h` for any arbitrary ratio
- **Divisibility** — output dimensions are snapped to multiples of `divisible_by` (default 8), ensuring compatibility with latent space operations
- **Model-agnostic** — no model-specific presets; just set `target_longest_side` to whatever your model needs (e.g. 1280 for SDXL, 832 for SD1.5, 480-832 for Wan)

---

### Crop to Ratio

Crop an image to a target aspect ratio using anchor-based positioning.

| | |
|---|---|
| **Required inputs** | `image` (IMAGE), `ratio` (dropdown), `anchor` (dropdown) |
| **Optional inputs** | `custom_ratio_w` (INT), `custom_ratio_h` (INT) |
| **Outputs** | `image` (IMAGE), `mask` (MASK), `x` (INT), `y` (INT), `crop_width` (INT), `crop_height` (INT), `width` (INT), `height` (INT) |

**Features:**
- **Same ratio presets** as Aspect Ratio node, plus Custom
- **9 anchor positions** — center, top-left, top-center, top-right, center-left, center-right, bottom-left, bottom-center, bottom-right
- **Maximum crop** — always computes the largest possible crop region that fits the target ratio
- **Mask output** — a mask of the original image dimensions with the crop region filled (useful for inpainting workflows)
- **Coordinate outputs** — `x`, `y`, `crop_width`, `crop_height` as plain INTs, compatible with the built-in ImageCrop node

---

### Interactive Crop

Visual crop editor with a fullscreen popup — draw, move, and resize a crop region with your mouse at edit time.

| | |
|---|---|
| **Inputs** | `image` (IMAGE), `crop_x` (INT), `crop_y` (INT), `crop_width` (INT), `crop_height` (INT) |
| **Outputs** | `image` (IMAGE), `mask` (MASK), `x` (INT), `y` (INT), `width` (INT), `height` (INT) |

**Features:**
- **`Select Crop Region` button** — opens a fullscreen popup overlay showing the connected source image
- **Draw** — click and drag on empty space to draw a new crop rectangle
- **Move** — drag inside the rectangle to reposition it
- **Resize** — drag corner handles (free resize) or edge handles (constrained resize)
- **Visual feedback** — dimmed area outside the crop, rule-of-thirds grid lines, live coordinate readout
- **Keyboard shortcuts** — Enter to apply, Escape to cancel
- **Coordinate outputs** — `x`, `y`, `width`, `height` as plain INTs, values saved to the node widgets and persisted in the workflow

**Note:** The popup needs to preview the source image. It works automatically when connected to Load Image from Folder or any node that has rendered a preview. For other sources, run the workflow once first to generate a preview.

## Compatibility

- Works with any ComfyUI version that supports `WEB_DIRECTORY` for frontend extensions
- All outputs use standard built-in types — no custom types that require other extensions
- Model-agnostic — works with SD1.5, SDXL, Flux, Wan, or any other model

## License

MIT

## Author

Morten Bo Bonding ([@morbobon](https://github.com/morbobon))
