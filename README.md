# MoBo Nodes

Custom utility nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI). Focused on image handling, aspect ratio management, cropping, and filename composition — filling gaps not covered by built-in nodes.

**Zero dependencies** — uses only standard ComfyUI types (IMAGE, MASK, INT, FLOAT, STRING). No external node packs required.

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/morbobon/MoBoNodes.git
```

Restart ComfyUI. All nodes appear under the **MoBo Nodes** category.

## Nodes

### Load Image from Folder

Browse and load images by folder — unlike the built-in Load Image node which dumps all input images into a single flat list.

**S&R name:** `LoadImageFromFolder`

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
- **Live info panel** drawn directly on the node showing all values at edit time
- **Smart ratio detection** — `closest_ratio` finds the nearest standard ratio (e.g. reports `"16:9"` for a 1920x1074 image, not `"320:179"`)
- **Exact ratio** — GCD-reduced ratio for precise values
- **Toggle button** — show/hide the info panel to save canvas space
- **Chain-aware** — walks upstream through connected nodes to find a preview image (works even when connected through other processing nodes)

Supported standard ratios: 1:1, 4:3, 3:4, 5:4, 4:5, 3:2, 2:3, 16:9, 9:16, 16:10, 10:16, 21:9, 9:21, 2:1, 1:2

---

### Aspect Ratio

Select or auto-detect an aspect ratio and compute a concrete pixel resolution. Feed the width/height outputs directly into Empty Latent Image, WanImageToVideo, or ImageScale.

| | |
|---|---|
| **Required inputs** | `ratio` (dropdown), `target_longest_side` (INT), `divisible_by` (INT) |
| **Optional inputs** | `image` (IMAGE), `input_width` (INT), `input_height` (INT), `auto_snap` (BOOLEAN), `custom_ratio_w` (INT), `custom_ratio_h` (INT) |
| **Outputs** | `ratio_string` (STRING), `width` (INT), `height` (INT), `ratio_float` (FLOAT) |

**Features:**
- **Standard ratio presets** — 1:1, 4:3, 3:4, 5:4, 4:5, 3:2, 2:3, 16:9, 9:16, 16:10, 10:16, 21:9, 9:21, 2:1, 1:2, plus Custom and From input
- **From input** — set ratio to "From input" to derive the ratio from a connected image or width/height INT inputs
- **Auto-snap** — automatically detect and snap to the nearest standard ratio from the input source
- **Custom ratio** — set `ratio` to "Custom" and use `custom_ratio_w` / `custom_ratio_h` for any arbitrary ratio
- **Divisibility** — output dimensions are snapped to multiples of `divisible_by` (default 8), ensuring compatibility with latent space operations
- **Model-agnostic** — no model-specific presets; just set `target_longest_side` to whatever your model needs (e.g. 1280 for SDXL, 832 for SD1.5, 480-832 for Wan)

**Typical I2V wiring:**

```
Interactive Crop ──→ width, height ──→ Aspect Ratio (From input, target: 832) ──→ width, height ──→ WanImageToVideo
```

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
- **Ratio toolbar** — row of buttons in the popup for standard ratios, plus:
  - **Image** (default) — locks to the input image's own aspect ratio
  - **Free** — freeform, no constraint
  - Switching ratios resets to the largest possible crop for that ratio
- **Draw** — click and drag on empty space to draw a new crop rectangle
- **Move** — drag inside the rectangle to reposition it
- **Resize** — drag corner handles (proportional when ratio-locked) or edge handles (freeform only)
- **Visual feedback** — dimmed area outside the crop, rule-of-thirds grid, lock icon, live coordinate and ratio readout
- **Save Cropped** — saves the cropped region at full resolution to the same input folder with a `_cropped` suffix
- **Reset** — restores crop to the largest possible region for the current ratio
- **Keyboard shortcuts** — Enter to apply, Escape to cancel

**Note:** The popup needs to preview the source image. Works automatically when connected to Load Image from Folder or any node with a preview. For other sources, run the workflow once first.

---

### Filename Builder

Compose output filenames from input parts using a template. Designed to work alongside ComfyUI's native `%date%` and `%NodeName.widget%` template system in SaveImage.

| | |
|---|---|
| **Required inputs** | `template` (STRING, multiline) |
| **Optional inputs** | `folder` (STRING), `filename` (STRING), `prefix` (STRING), `suffix` (STRING), `width` (INT), `height` (INT) |
| **Outputs** | `filename` (STRING), `folder` (STRING passthrough) |

**Template variables** (use `{variable}` syntax):

| Variable | Source | Example |
|---|---|---|
| `{folder}` | folder input, path separators become underscores | `ships` |
| `{name}` | filename input, extension stripped | `frigate_sails01` |
| `{ext}` | extension from filename | `jpg` |
| `{prefix}` | prefix input | `render` |
| `{suffix}` | suffix input | `HD-60FPS` |
| `{width}` | width input (omitted if 0) | `1280` |
| `{height}` | height input (omitted if 0) | `720` |
| `{res}` | widthxheight shorthand | `1280x720` |

ComfyUI's native `%tokens%` (like `%date:yyyy_MM_dd%`) **pass through unchanged** for SaveImage to resolve. You can mix both:

```
{folder}_{name}_%date:yyyy_MM_dd%_{suffix}
```

**Examples:**

| Template | Result |
|---|---|
| `{folder}_{name}` | `ships_frigate_sails01` |
| `{name}_{res}` | `frigate_sails01_1280x720` |
| `{folder}_{name}_%date:yyyy_MM_dd%_{suffix}` | `ships_frigate_sails01_%date:yyyy_MM_dd%_HD-60FPS` |

Empty/unconnected variables produce nothing (no double separators). SaveImage adds its own counter and file extension.

## Example Workflow: I2V with Wan

```
Load Image from Folder ──→ IMAGE ──→ Interactive Crop ──→ IMAGE ──────────→ WanImageToVideo
       ↓ folder, filename                  ↓ width, height                        ↑
       ↓                              Aspect Ratio (From input, 832) → w, h ──────┘
       ↓
  Filename Builder ({folder}_{name}_%date:yyyy_MM_dd%_{suffix}) ──→ SaveVideo filename
```

## Compatibility

- Works with any ComfyUI version that supports `WEB_DIRECTORY` for frontend extensions
- All outputs use standard built-in types — no custom types that require other extensions
- Model-agnostic — works with SD1.5, SDXL, Flux, Wan, or any other model

## License

MIT

## Author

MoBo ([@morbobon](https://github.com/morbobon))
