# MoBo Nodes

Custom utility nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI). Focused on image loading, aspect ratio management, visual cropping + masking, and filename composition — filling gaps not covered by built-in nodes.

**Zero dependencies** — uses only standard ComfyUI types (IMAGE, MASK, INT, FLOAT, STRING). No external node packs required.

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/morbobon/MoBoNodes.git
```

Restart ComfyUI. All nodes appear under the **MoBo Nodes** category.

## Nodes

| Node | S&R name | One-liner |
|---|---|---|
| Load Image from Folder | `LoadImageFromFolder` | Browse images by subfolder |
| **Load Image Plus** | `LoadImagePlus` | Feature-rich loader with built-in Crop+Mask editor, aspect/resolution control, and batch cycling |
| Image Info | `ImageInfo` | Live dimension/ratio/megapixel panel on the node |
| Aspect Ratio | `AspectRatio` | Snap to standard ratio, compute output width/height |
| Crop to Ratio | `CropToRatio` | Anchor-based crop to target ratio |
| **Interactive Crop** | `InteractiveCrop` | Full-screen popup editor: crop, mask, rotate, flip, pad |
| Filename Builder | `FilenameBuilder` | Compose filenames + folders from `{variable}` templates |
| **String Selector Plus** | `StringSelectorPlus` | Pick a line from a list, output the line + index, expose the line as a widget for filename use |

---

### Load Image from Folder

Browse and load images by folder — unlike the built-in Load Image node which dumps all input images into a single flat list.

| | |
|---|---|
| **Inputs** | `subfolder` (dropdown), `image` (dropdown) |
| **Outputs** | `image` (IMAGE), `mask` (MASK), `folder` (STRING), `filename` (STRING) |

- Folder dropdown lists all subfolders under `input/`, including nested folders
- Selecting a folder repopulates the image dropdown
- Image preview drawn on the node tile
- Upload button + drag-and-drop into the currently selected subfolder
- Workflow persistence: saved folder/image restore correctly when reopening

---

### Load Image Plus

A feature-rich loader with everything the basic loader has **plus** aspect/resolution control, a full-screen Crop + Mask editor, filename-template widgets, and batch cycling.

| | |
|---|---|
| **Required inputs** | `use_output_dir`, `subfolder`, `image`, `aspect_ratio`, `resolution_preset`, `target_resolution`, `snap_to_8`, `longest_side` |
| **Optional inputs (templates)** | `outfile_template`, `outfolder_template` |
| **Hidden widgets** (exposed for `%LoadImagePlus.widget%` substitution) | `subfolderid`, `fileid`, `outfile`, `outfolder` |
| **Outputs** | `image` (IMAGE), `mask` (MASK), `fileid` (STRING), `width` (INT), `height` (INT) |

**Features:**

- **Subfolder browser with counts** — top of the dropdown has `● [input]` / `○ [output]` mode switches; each folder shows its image count. Counts are auto-refreshed when you click the dropdown, change folder, or archive an image.
- **Output Resolution section** (collapsible) — `aspect_ratio`, `resolution_preset`, `target_resolution`, `snap_to_8`, `longest_side`:
  - **Resolution presets**: `From input`, `240p`, `280p`, `304p`, `320p`, `360p`, `400p`, `416p`, `480p`, `504p`, `576p`, `720p`, `1080p`, `1440p`, `2160p`, `Custom`. All preset values are multiples of 8.
  - **Aspect ratio**: standard list, or `From input` (snaps the image's own ratio to the nearest standard).
  - **`snap_to_8`**: rounds width/height to multiples of 8 — and *also* snaps the `target_resolution` field itself, including the arrow-step (±8 instead of ±1) when on.
  - **`longest_side`**: which side the preset value refers to. `shortest` (default) → `720p` on 16:9 = 1280×720. `longest` → `720p` on 16:9 = 720×400.
  - The collapsed header shows the resolved size, e.g. `▼ Output Resolution · 1280×720 (16:9)`.
- **🗄 Archive image button** — moves the currently-selected file into an `archive/` subfolder alongside it (created on demand) and advances to the next image in the folder. Server-side, with path-traversal safety and de-collision (`name_1.jpg`, `_2`, …).
- **`Edit image` button** — opens the shared [Crop/Mask editor](#the-cropmask-editor-shared-by-interactive-crop--load-image-plus) for the currently selected image.
- **Upload** — upload or drag-and-drop an image; goes into the currently selected subfolder.
- **Output Name section** (collapsible):
  - Single-line `outfile_template` and `outfolder_template` — `{variable}` templates resolved client-side into hidden `outfile` / `outfolder` widgets.
  - Reference the resolved values in SaveImage's `filename_prefix` as `%LoadImagePlus.outfile%` or `%LoadImagePlus.outfolder%`.
  - Supported variables: `{subfolderid}`, `{fileid}`, `{filename}`, `{aspect}`, `{width}`, `{height}`, `{res}`, `{workflowname}`, `{date:FORMAT}` (FORMAT uses `yyyy yy MM M dd d hh h mm m ss s`).
  - **Truncation:** Append `-N` to any variable to limit its length to N characters. E.g., `{filename-20}`, `{workflowname-15}`. Useful when chaining nodes with long filenames.
  - Any `%…%` tokens pass through for SaveImage to resolve.
  - **Default templates** (pre-filled when you add the node):
    - `outfile_template`: `{subfolderid}-{fileid}{workflowname}_{date:hhMM}-` → e.g. `dogs-puppies-rni52my_workflow_1430-`
    - `outfolder_template`: `{date:yyyy_MM_dd}` → e.g. `2026_05_01`
- **Sort & Filter section** (collapsible) — controls which files populate the `image` dropdown for the currently selected subfolder:
  - **Sort by**: `Date-time` (default, file modified time) or `Filename` (alphabetical).
  - **Order**: `Descending` (default — newest first / Z→A) or `Ascending` (oldest first / A→Z).
  - **Filter**: glob-style wildcard, e.g. `*ship*` matches any filename containing "ship" (case-insensitive). Empty = no filtering.
  - UI-only state (like "After generate") — not sent to Python as a node input; resolved server-side on every folder/subfolder refresh.
  - "After generate" cycling and the Archive button's "advance to next image" both operate on the filtered/sorted list.
- **Show Preview** — toggleable fixed-height preview (the node's height stays constant regardless of the loaded image's aspect ratio).
- **After generate** — standard ComfyUI "control after generate" cycling (`fixed` / `increment` / `decrement` / `randomize`) so you can batch-process a folder.
- **`fileid`** output — 5-char base36 hash of the filename (filename-safe, deterministic). Folder path is *not* part of the hash — same filename in two folders → same `fileid`. The widget itself is hidden but still serialized so `%LoadImagePlus.fileid%` works in `filename_prefix`.
- **State persistence** — all widget values save by name (not positionally), so reordering/renaming widgets in future versions doesn't scramble saved workflows.

---

### The Crop/Mask editor (shared by Interactive Crop + Load Image Plus)

Full-screen popup editor with two tools, a transform strip, and padding / output-resolution controls.

**Crop tool:**

- **Ratio bar** — Free, Image (the source's own ratio), plus all standard ratios (1:1, 4:3, 3:4, 5:4, 4:5, 3:2, 2:3, 16:9, 9:16, 16:10, 10:16, 21:9, 9:21, 2:1, 1:2).
- **Draw** — click on an empty area and drag to create a new crop rect.
- **Move** — drag inside the rect to pan the image underneath (the rect stays as a static viewfinder).
- **Resize** — drag the corner/edge handles (corners only when ratio-locked).
- **Scroll to zoom** — wheel zooms the image under the static rect; rect itself stays the same on-screen size.
- **Rule-of-thirds grid**, dimmed area outside the rect, lock icon when ratio-locked.

**Transform strip (crop mode):**

- `⟳ 90°`, `↔` flip horizontal, `↕` flip vertical.
- **Freehand rotation slider** (−45° to +45°, snaps to 0 at ±1°). Rotation pivots around the crop center.
- **Constrain to image** checkbox *(default ON)*:
  - **ON**: the crop is clamped to stay fully inside the rotated image. Rotating shrinks the crop to the largest inscribed rect; zoom/pan/resize are bounded so the rotated crop always fits.
  - **OFF**: the crop can extend past the image. Rotating grows the crop to the outer bounding box of the rotated image so the whole image survives into the output, with padding at the corners.
- **Pad:** dropdown — Transparent / Color / Noise. Controls how areas outside the source image are filled on save.
- **Res:** dropdown — output resolution mode:
  - *Match source* — output short side ≤ source short side (no upscale).
  - *Balanced* (default) — geometric mean between Match and Native.
  - *Native (max)* — 1:1 with source pixels; preserves maximum detail at the cost of larger files that grow with rotation/padding.

**Mask tool:**

- **Brush** with adjustable size (slider + mouse wheel).
- **Add / Remove** modes (right-click also erases).
- **Fill mode** — Transparent / Color / Noise / Blur (light/medium/heavy).
- **Eyedropper** — pick color directly from the image.
- **Undo / Redo** (Ctrl+Z / Ctrl+Y, up to 30 steps).
- **Apply Mask** bakes the fill into the working image.
- **💾 Mask** — saves the painted mask as a grayscale PNG alongside the image.

**Save / Apply:**

- **💾 Save** — writes the current crop + transform + mask output to the input folder. Filename postfixes are auto-appended (`_cropped`, `_crop-16x9`, `_r-12`, `_flipH`, `_masked`, `_noised`, `_blurred`, `_filled`…).
- **Apply** (Interactive Crop only) — writes crop x/y/width/height back into the node widgets without saving a new file.
- **Reset** — in crop mode resets *both* the crop region and the transform (rotation + flips). In mask mode clears the painted mask.
- **Keyboard**: Enter = Apply, Esc = Cancel, R = Reset (crop mode).

Drag and mouseup are handled on the entire overlay, so drags survive leaving the canvas area.

---

### Image Info

Displays image metadata at edit time — no need to run the workflow first.

| | |
|---|---|
| **Inputs** | `image` (IMAGE) |
| **Outputs** | `width` (INT), `height` (INT), `ratio_float` (FLOAT), `closest_ratio` (STRING), `exact_ratio` (STRING), `orientation` (STRING), `megapixels` (FLOAT) |

- Live info panel drawn directly on the node
- `closest_ratio` reports the nearest standard (e.g. `16:9` for 1920×1074, not `320:179`)
- Chain-aware — walks upstream through connected nodes to find a preview image
- Toggle button to hide/show the info panel

Supported standard ratios: 1:1, 4:3, 3:4, 5:4, 4:5, 3:2, 2:3, 16:9, 9:16, 16:10, 10:16, 21:9, 9:21, 2:1, 1:2.

---

### Aspect Ratio

Select or auto-detect an aspect ratio and compute a concrete pixel resolution. Feed the width/height directly into Empty Latent Image, WanImageToVideo, or ImageScale.

| | |
|---|---|
| **Required** | `ratio`, `target_longest_side` (INT), `divisible_by` (INT) |
| **Optional** | `image` (IMAGE), `input_width` (INT), `input_height` (INT), `auto_snap` (BOOLEAN), `custom_ratio_w` (INT), `custom_ratio_h` (INT) |
| **Outputs** | `ratio_string` (STRING), `width` (INT), `height` (INT), `ratio_float` (FLOAT) |

- Standard ratio presets + Custom + "From input"
- `auto_snap` automatically snaps to the nearest standard ratio from the input source
- Dimensions snapped to multiples of `divisible_by` (default 8) for latent-space compatibility
- Model-agnostic — set `target_longest_side` to whatever your model wants (1280 for SDXL, 832 for SD1.5, 480–832 for Wan, etc.)

---

### Crop to Ratio

Anchor-based crop to a target aspect ratio (non-interactive; for workflow-level ratio enforcement).

| | |
|---|---|
| **Required** | `image` (IMAGE), `ratio`, `anchor` |
| **Optional** | `custom_ratio_w` (INT), `custom_ratio_h` (INT) |
| **Outputs** | `image` (IMAGE), `mask` (MASK), `x` (INT), `y` (INT), `crop_width` (INT), `crop_height` (INT), `width` (INT), `height` (INT) |

- Same ratio presets as the Aspect Ratio node, plus Custom
- 9 anchor positions — center, top-left/top/top-right, center-left/center-right, bottom-left/bottom/bottom-right
- Always computes the *largest* crop that fits the target ratio
- Mask output at the original dimensions with the crop region filled (useful for inpainting)

---

### Interactive Crop

Visual crop editor using the full-screen popup editor described [above](#the-cropmask-editor-shared-by-interactive-crop--load-image-plus). Writes back to node widgets so downstream nodes can crop.

| | |
|---|---|
| **Inputs** | `image` (IMAGE), `crop_x` (INT), `crop_y` (INT), `crop_width` (INT), `crop_height` (INT) |
| **Outputs** | `image` (IMAGE), `mask` (MASK), `x` (INT), `y` (INT), `width` (INT), `height` (INT) |

- **`Show & Edit Image` button** — opens the popup editor with all crop/mask/transform/padding/resolution controls.
- **Apply** in the editor writes `x`/`y`/`width`/`height` back into the node widgets.
- **💾 Save** writes a new file to the input folder (see Save filename postfixes above).

**Note:** The popup needs a preview of the source image. Works out of the box when connected to Load Image, Load Image from Folder, Load Image Plus, or any node with a preview; for other sources, run the workflow once first.

---

### Filename Builder

Compose **both** a filename and a folder path from `{variable}` templates. Designed to work alongside ComfyUI's native `%date%` and `%NodeName.widget%` token system in SaveImage.

| | |
|---|---|
| **Required** | `filename_template` (STRING), `folder_template` (STRING) |
| **Optional** | `folder`, `filename`, `fileid`, `prefix`, `suffix`, `width` (INT), `height` (INT) |
| **Outputs** | `filename` (STRING), `folder` (STRING) |

**Template variables** (`{variable}` syntax):

| Variable | Source | Example |
|---|---|---|
| `{folder}` | folder input (path separators preserved) | `ships/frigates` |
| `{filename}` or `{name}` | filename input, extension stripped | `frigate_sails01` |
| `{ext}` | extension from filename | `jpg` |
| `{fileid}` | short heuristic id (e.g. from Load Image Plus) | `rni52` |
| `{prefix}` / `{suffix}` | prefix / suffix inputs | `render` / `HD-60FPS` |
| `{width}` / `{height}` | dimensions (empty if 0) | `1280` / `720` |
| `{res}` | width×height shorthand | `1280x720` |
| `{aspect}` | filename-safe ratio snapped to nearest standard | `16x9` |

ComfyUI's native `%tokens%` (like `%date:yyyy_MM_dd%`, `%LoadImagePlus.outfile%`) **pass through unchanged** for SaveImage to resolve. You can mix both:

```
{folder}/{fileid}_{aspect}_%date:yyyy_MM_dd%_{suffix}
```

Cleanup is minimal — every character you type is preserved (including `:` for date tokens and `/` for subfolders); only backslashes become forward slashes and consecutive `/`, `_`, `-` runs are collapsed.

---

### String Selector Plus

A small extension of the Impact Pack `StringSelector` concept. Pick one line from a multiline list and use the resolved index to drive parallel switches (e.g. EasyUse `Text Index Switch`) elsewhere in the workflow, while embedding the chosen line's *name* in the saved filename.

| | |
|---|---|
| **Required** | `select` (INT), `strings` (STRING, multiline) |
| **Hidden widget** | `selected` (STRING — kept in sync client-side, exists for `%StringSelectorPlus.selected%` substitution) |
| **Outputs** | `string` (STRING), `index` (INT) |

- One entry per line; blank lines skipped. Use filename-safe names on each line if you want to reference them in filenames.
- `select` wraps with modulo if it exceeds the entry count (Impact Pack semantics) — and the displayed value snaps to the wrapped index visually.
- The hidden `selected` widget is updated on every change to `strings` or `select`, so SaveImage's `filename_prefix` can use `%StringSelectorPlus.selected%` and get the chosen line.
- The list of entries renders below the editable textarea as a clickable list — the selected entry is highlighted in blue, and clicking any other entry sets `select` to that index.
- The `strings` textarea itself is collapsible (`▼ / ▶ Entries (edit)` toggle) so the node stays compact once your list is set.
- All values save by name in `node.properties.moboNamed`, robust to widget reordering across versions.

**Typical wiring:**

```
                     ┌─→ Text Index Switch (positive variants) ─→ CLIP +
String Selector Plus ┼─→ Text Index Switch (negative variants) ─→ CLIP -
       ↓ index       └─→ Text Index Switch (motion descriptions) ─→ …
       └──→ all switches share the same index, so all variants flip in lockstep

       SaveImage filename_prefix:  base_%StringSelectorPlus.selected%_%date:yyyyMMdd%
       → base_VariantName_20260501.mp4
```

---

## Example Workflow: I2V with Wan

```
Load Image Plus ──→ IMAGE ──→ Interactive Crop ──→ IMAGE ──────────→ WanImageToVideo
     ↓ fileid, width, height         ↓ width, height                     ↑
     ↓                     Aspect Ratio (From input, 832) → w, h ────────┘
     ↓
Filename Builder
  filename_template: {fileid}_{aspect}_%date:yyyy_MM_dd%
  folder_template:   {folder}
  ──→ SaveVideo filename_prefix + output dir
```

## Compatibility

- Works with any ComfyUI version that supports `WEB_DIRECTORY` for frontend extensions
- All outputs use standard built-in types — no custom types that require other extensions
- Model-agnostic — works with SD1.5, SDXL, Flux, Wan, or any other model

## License

MIT

## Author

MoBo ([@morbobon](https://github.com/morbobon))
