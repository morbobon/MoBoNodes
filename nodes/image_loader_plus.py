import os
import hashlib
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths
import node_helpers
import comfy.model_management

from .aspect_ratio import STANDARD_RATIOS, snap_to_nearest_ratio, compute_resolution
from .image_loader import get_subfolders, get_images_in_folder


# --- Resolution helpers ---

RESOLUTION_PRESETS = [
    "From input",
    "240p", "280p", "304p", "320p", "360p", "400p", "416p", "480p", "504p",
    "576p", "720p", "1080p", "1440p", "2160p",
    "Custom",
]

RESOLUTION_MAP = {
    "240p": 240, "280p": 280, "304p": 304, "320p": 320, "360p": 360,
    "400p": 400, "416p": 416, "480p": 480, "504p": 504, "576p": 576,
    "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160,
}

ASPECT_RATIO_OPTIONS = list(STANDARD_RATIOS.keys()) + ["From input"]


def compute_target_dims(img_w, img_h, aspect_ratio, resolution_preset, target_resolution, snap_to_8, longest_side=False):
    """Return (out_w, out_h) using aspect ratio + resolution preset.

    `longest_side` controls whether the resolution preset value (e.g. 720p)
    refers to the SHORT side (default) or the LONG side of the output.
    """
    # Determine ratio
    if aspect_ratio == "From input":
        if img_w > 0 and img_h > 0:
            matched = snap_to_nearest_ratio(img_w, img_h)
            rw, rh = STANDARD_RATIOS[matched]
        else:
            rw, rh = 1, 1
    else:
        rw, rh = STANDARD_RATIOS.get(aspect_ratio, (1, 1))

    # "From input" resolution: preserve image dimensions (or apply ratio to a side)
    if resolution_preset == "From input":
        if aspect_ratio == "From input" and img_w > 0 and img_h > 0:
            return img_w, img_h
        if longest_side:
            side = max(img_w, img_h) if max(img_w, img_h) > 0 else 512
        else:
            side = min(img_w, img_h) if min(img_w, img_h) > 0 else 512
    else:
        side = RESOLUTION_MAP.get(resolution_preset, target_resolution)

    divisible_by = 8 if snap_to_8 else 1
    return compute_resolution(rw, rh, side, divisible_by, longest_side=longest_side)


def _resolve_base_dir(use_output_dir):
    return folder_paths.get_output_directory() if use_output_dir else folder_paths.get_input_directory()


_FILE_ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz"  # base36


def _simple_hash5(s):
    """Dumb polynomial rolling hash → 5 base36 chars. Deterministic. No crypto."""
    h = 0
    for c in s:
        h = (h * 131 + ord(c)) & 0xFFFFFFFFFFFFFFFF
    out = ""
    for _ in range(5):
        out = _FILE_ID_CHARS[h % 36] + out
        h //= 36
    return out


def generate_fileid(subfolder, filename):
    """Short heuristic identifier: just the 5-char base36 hash of the filename.

    Folder information is intentionally NOT included — use FilenameBuilder's
    {folder} variable if you want folder segments in your output filename.
    """
    if not filename:
        return ""
    return _simple_hash5(filename)


# --- Node ---

class MoBo_ImageLoaderPlus:
    """Feature-rich image loader with aspect/resolution control, built-in editor, and batch cycling."""

    DESCRIPTION = "Load images from input/ or output/ with aspect-ratio/resolution control, a built-in Crop + Mask editor, and 'After generate' cycling for batch processing."

    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        subfolders = get_subfolders(input_dir)
        default_folder = subfolders[0] if subfolders else "."
        images = get_images_in_folder(input_dir, default_folder)
        if not images:
            images = ["none"]

        return {
            "required": {
                "use_output_dir": ("BOOLEAN", {"default": False,
                    "tooltip": "If true, browses ComfyUI/output/ instead of ComfyUI/input/. Normally toggled via the [input] / [output] entries in the subfolder dropdown."}),
                "subfolder": (subfolders, {"default": default_folder,
                    "tooltip": "Subfolder to load from. Top entries [input] / [output] switch source; each folder shows its image count."}),
                "image": (images, {
                    "tooltip": "Image file to load from the current folder."}),
                "aspect_ratio": (ASPECT_RATIO_OPTIONS, {"default": "From input",
                    "tooltip": "Output aspect ratio. 'From input' snaps the image's own ratio to the nearest standard (e.g. 1920×1080 → 16:9)."}),
                "resolution_preset": (RESOLUTION_PRESETS, {"default": "320p",
                    "tooltip": "Short-side pixel count. 'From input' preserves the image's original size (or short side); 'Custom' uses target_resolution."}),
                "target_resolution": ("INT", {"default": 320, "min": 1, "max": 8192, "step": 1,
                    "tooltip": "Custom short-side pixel count. Only used when resolution_preset = 'Custom'."}),
                "snap_to_8": ("BOOLEAN", {"default": True,
                    "tooltip": "Round output width and height down to multiples of 8 (recommended for most diffusion models)."}),
                "longest_side": ("BOOLEAN", {"default": False,
                    "label_on": "longest", "label_off": "shortest",
                    "tooltip": "Whether the resolution preset (e.g. '720p') refers to the LONGEST or SHORTEST side of the output. Default: shortest. With ON, '720p' on a 16:9 ratio gives 720×405 instead of 1280×720."}),
            },
            "optional": {
                "subfolderid": ("STRING", {"default": "",
                    "tooltip": "Dash-separated subfolder path (e.g. 'dogs-puppies'), auto-computed from the subfolder selection. Hidden widget; use %LoadImagePlus.subfolderid% in SaveImage filename_prefix to reference it."}),
                "fileid": ("STRING", {"default": "",
                    "tooltip": "5-char base36 hash of the filename (mirrors the fileid output as a widget so %LoadImagePlus.fileid% works in SaveImage filename_prefix)."}),
                "outfile_template": ("STRING", {
                    "default": "{subfolderid}-{fileid}{workflowname}_{date:hhMM}-",
                    "tooltip": "Template for the filename. Variables: {subfolderid}, {fileid}, {filename}, {aspect}, {width}, {height}, {res}, {workflowname}, {date:FORMAT} (yyyy yy MM M dd d hh h mm m ss s). Resolved client-side. The RESOLVED value is in the hidden 'outfile' widget — reference via %LoadImagePlus.outfile% in SaveImage filename_prefix. Any %Node.widget% tokens still pass through for SaveImage to resolve.",
                }),
                "outfolder_template": ("STRING", {
                    "default": "{date:yyyy_MM_dd}",
                    "tooltip": "Template for the folder. Same variables as outfile_template (incl. {date:FORMAT} and {workflowname}). Resolves into the hidden 'outfolder' widget — reference via %LoadImagePlus.outfolder%.",
                }),
                "outfile":   ("STRING", {"default": "",
                    "tooltip": "Auto-computed filename from outfile_template (hidden). Reference via %LoadImagePlus.outfile% in SaveImage filename_prefix."}),
                "outfolder": ("STRING", {"default": "",
                    "tooltip": "Auto-computed folder from outfolder_template (hidden). Reference via %LoadImagePlus.outfolder%."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "fileid", "width", "height")
    OUTPUT_TOOLTIPS = (
        "Loaded RGB image tensor.",
        "Alpha channel as a mask (zeros if the image has no alpha).",
        "Short 5-char base36 hash of the filename — filename-safe and deterministic (e.g. 'rni52'). Folder info is NOT included; use FilenameBuilder's {folder} variable to add that.",
        "Computed output width (from aspect_ratio + resolution_preset).",
        "Computed output height.",
    )
    FUNCTION = "load_image"
    CATEGORY = "MoBo Nodes"

    def load_image(self, use_output_dir, subfolder, image, aspect_ratio, resolution_preset, target_resolution, snap_to_8,
                   longest_side=False,
                   subfolderid="", fileid="", outfile="", outfolder="",
                   outfile_template="", outfolder_template=""):
        # All UI-only widgets (computed client-side for %Node.widget% substitution); ignored here
        del subfolderid, fileid, outfile, outfolder, outfile_template, outfolder_template
        base_dir = _resolve_base_dir(use_output_dir)

        if subfolder == ".":
            image_path = os.path.join(base_dir, image)
            subfolder_rel = ""
        else:
            image_path = os.path.join(base_dir, subfolder, image)
            subfolder_rel = subfolder

        img = node_helpers.pillow(Image.open, image_path)

        output_images = []
        output_masks = []
        w, h = None, None
        dtype = comfy.model_management.intermediate_dtype()

        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)
            if i.mode == "I":
                i = i.point(lambda x: x * (1 / 255))
            frame = i.convert("RGB")

            if len(output_images) == 0:
                w = frame.size[0]
                h = frame.size[1]
            if frame.size[0] != w or frame.size[1] != h:
                continue

            frame_np = np.array(frame).astype(np.float32) / 255.0
            frame_tensor = torch.from_numpy(frame_np)[None,]

            if "A" in i.getbands():
                mask = np.array(i.getchannel("A")).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(mask)
            elif i.mode == "P" and "transparency" in i.info:
                mask = np.array(i.convert("RGBA").getchannel("A")).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(mask)
            else:
                mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")

            output_images.append(frame_tensor.to(dtype=dtype))
            output_masks.append(mask.unsqueeze(0).to(dtype=dtype))

            if img.format == "MPO":
                break

        if len(output_images) > 1:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

        img_w = output_image.shape[2]
        img_h = output_image.shape[1]
        out_w, out_h = compute_target_dims(img_w, img_h, aspect_ratio, resolution_preset, target_resolution, snap_to_8, longest_side=longest_side)

        fileid = generate_fileid(subfolder_rel, image)
        return (output_image, output_mask, fileid, out_w, out_h)

    @classmethod
    def IS_CHANGED(s, use_output_dir, subfolder, image, aspect_ratio, resolution_preset, target_resolution, snap_to_8,
                   longest_side=False,
                   subfolderid="", fileid="", outfile="", outfolder="",
                   outfile_template="", outfolder_template=""):
        base_dir = _resolve_base_dir(use_output_dir)
        if subfolder == ".":
            image_path = os.path.join(base_dir, image)
        else:
            image_path = os.path.join(base_dir, subfolder, image)
        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, use_output_dir, subfolder, image, aspect_ratio, resolution_preset, target_resolution, snap_to_8,
                        longest_side=False,
                        subfolderid="", fileid="", outfile="", outfolder="",
                        outfile_template="", outfolder_template=""):
        base_dir = _resolve_base_dir(use_output_dir)
        if subfolder == ".":
            image_path = os.path.join(base_dir, image)
        else:
            image_path = os.path.join(base_dir, subfolder, image)
        if not os.path.isfile(image_path):
            return "Invalid image file: {}".format(image)
        return True
