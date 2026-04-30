import os
import hashlib
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths
import node_helpers
import comfy.model_management
from aiohttp import web
from server import PromptServer


def get_subfolders(input_dir):
    """Get list of subfolders under the input directory, including root.

    Paths are sorted globally so each parent is immediately followed by its
    entire subtree in depth-first order (e.g. `_folder`, `_folder/sub1`,
    `_folder/sub2`, `other`, `other/sub3`).
    """
    all_paths = []
    for root, dirs, _files in os.walk(input_dir):
        dirs.sort()  # keep walk descent alphabetical for consistency
        for d in dirs:
            rel = os.path.relpath(os.path.join(root, d), input_dir).replace("\\", "/")
            all_paths.append(rel)
    all_paths.sort()
    return ["."] + all_paths


def get_images_in_folder(input_dir, subfolder):
    """Get list of image files in a specific subfolder of the input directory."""
    if subfolder == ".":
        target = input_dir
    else:
        target = os.path.join(input_dir, subfolder)

    target = os.path.realpath(target)
    if not target.startswith(os.path.realpath(input_dir)):
        return []

    if not os.path.isdir(target):
        return []

    files = [f for f in os.listdir(target) if os.path.isfile(os.path.join(target, f))]
    return sorted(folder_paths.filter_files_content_types(files, ["image"]))


# --- API Routes ---

def _dir_for_type(source_type):
    if source_type == "output":
        return folder_paths.get_output_directory()
    return folder_paths.get_input_directory()


@PromptServer.instance.routes.get("/mobo_nodes/image_loader/subfolders")
async def list_subfolders(request):
    source_type = request.rel_url.query.get("type", "input")
    with_counts = request.rel_url.query.get("with_counts") in ("1", "true", "yes")
    base = _dir_for_type(source_type)
    subfolders = get_subfolders(base)
    if not with_counts:
        return web.json_response(subfolders)
    # Attach per-folder image counts
    result = []
    for sub in subfolders:
        try:
            count = len(get_images_in_folder(base, sub))
        except Exception:
            count = 0
        result.append({"path": sub, "count": count})
    return web.json_response(result)


@PromptServer.instance.routes.get("/mobo_nodes/image_loader/images")
async def list_images(request):
    subfolder = request.rel_url.query.get("subfolder", ".")
    source_type = request.rel_url.query.get("type", "input")
    base = _dir_for_type(source_type)
    images = get_images_in_folder(base, subfolder)
    return web.json_response(images)


@PromptServer.instance.routes.post("/mobo_nodes/image_loader/archive")
async def archive_image(request):
    """Move an image into an `archive/` subfolder of its current location.

    Body (JSON): { type, subfolder, filename }
      - type: 'input' or 'output'
      - subfolder: source subfolder relative to the type's base dir (or '.')
      - filename: image file to move

    Creates `<base>/<subfolder>/archive/` if missing. If the destination
    filename already exists, suffixes `_1`, `_2`, … to avoid clobbering.
    Returns: { ok, archive_subfolder, new_filename }
    """
    try:
        data = await request.json()
        source_type = data.get("type", "input")
        subfolder   = data.get("subfolder", ".") or "."
        filename    = data.get("filename", "")

        if not filename:
            return web.json_response({"ok": False, "error": "missing filename"}, status=400)

        base = _dir_for_type(source_type)
        base_real = os.path.realpath(base)

        # Resolve source
        if subfolder == "." or subfolder == "":
            src_dir = base
            archive_rel = "archive"
        else:
            src_dir = os.path.join(base, subfolder)
            archive_rel = subfolder.rstrip("/\\") + "/archive"

        src_path = os.path.realpath(os.path.join(src_dir, filename))
        if not src_path.startswith(base_real):
            return web.json_response({"ok": False, "error": "path traversal blocked"}, status=400)
        if not os.path.isfile(src_path):
            return web.json_response({"ok": False, "error": "source file not found"}, status=404)

        # Create archive folder
        archive_dir = os.path.join(src_dir, "archive")
        os.makedirs(archive_dir, exist_ok=True)

        # De-collide destination filename
        stem, ext = os.path.splitext(filename)
        candidate = filename
        i = 1
        while os.path.exists(os.path.join(archive_dir, candidate)):
            candidate = f"{stem}_{i}{ext}"
            i += 1

        dst_path = os.path.realpath(os.path.join(archive_dir, candidate))
        if not dst_path.startswith(base_real):
            return web.json_response({"ok": False, "error": "path traversal blocked"}, status=400)

        os.replace(src_path, dst_path)
        return web.json_response({
            "ok": True,
            "archive_subfolder": archive_rel,
            "new_filename": candidate,
        })
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


# --- Node ---

class MoBo_FolderImageLoader:
    """Basic image loader that browses ComfyUI's input directory by subfolder."""

    DESCRIPTION = "Load an image from any subfolder under ComfyUI/input/. Supports upload and drag-and-drop. See also: Load Image Plus for aspect ratio / resolution control and an edit popup."

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
                "subfolder": (subfolders, {"default": default_folder,
                    "tooltip": "Subfolder under ComfyUI/input/; '.' means the root."}),
                "image": (images, {
                    "tooltip": "Image file to load from the selected subfolder."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("image", "mask", "folder", "filename")
    OUTPUT_TOOLTIPS = (
        "Loaded RGB image tensor.",
        "Alpha channel as a mask (zeros if the image has no alpha).",
        "Selected subfolder name (empty string when root).",
        "Selected filename.",
    )
    FUNCTION = "load_image"
    CATEGORY = "MoBo Nodes"

    def load_image(self, subfolder, image):
        input_dir = folder_paths.get_input_directory()

        if subfolder == ".":
            image_path = os.path.join(input_dir, image)
            folder_output = ""
        else:
            image_path = os.path.join(input_dir, subfolder, image)
            folder_output = subfolder

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

        return (output_image, output_mask, folder_output, image)

    @classmethod
    def IS_CHANGED(s, subfolder, image):
        input_dir = folder_paths.get_input_directory()
        if subfolder == ".":
            image_path = os.path.join(input_dir, image)
        else:
            image_path = os.path.join(input_dir, subfolder, image)
        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, subfolder, image):
        input_dir = folder_paths.get_input_directory()
        if subfolder == ".":
            image_path = os.path.join(input_dir, image)
        else:
            image_path = os.path.join(input_dir, subfolder, image)
        if not os.path.isfile(image_path):
            return "Invalid image file: {}".format(image)
        return True
