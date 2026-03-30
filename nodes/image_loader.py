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
    """Get list of subfolders under the input directory, including root."""
    subfolders = ["."]
    for root, dirs, _files in os.walk(input_dir):
        for d in sorted(dirs):
            rel = os.path.relpath(os.path.join(root, d), input_dir).replace("\\", "/")
            subfolders.append(rel)
    return subfolders


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

@PromptServer.instance.routes.get("/mobo_nodes/image_loader/subfolders")
async def list_subfolders(request):
    input_dir = folder_paths.get_input_directory()
    subfolders = get_subfolders(input_dir)
    return web.json_response(subfolders)


@PromptServer.instance.routes.get("/mobo_nodes/image_loader/images")
async def list_images(request):
    subfolder = request.rel_url.query.get("subfolder", ".")
    input_dir = folder_paths.get_input_directory()
    images = get_images_in_folder(input_dir, subfolder)
    return web.json_response(images)


# --- Node ---

class MoBo_FolderImageLoader:
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
                "subfolder": (subfolders, {"default": default_folder}),
                "image": (images, {}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("image", "mask", "folder", "filename")
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
