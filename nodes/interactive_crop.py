import torch
import numpy as np


class MoBo_InteractiveCrop:
    """
    Interactive crop node with a visual popup editor.
    The crop region is selected at edit time via a JS popup overlay.
    The x, y, width, height widget values are set by the popup and used at execution time.
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "crop_x": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_y": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_width": ("INT", {"default": 512, "min": 1, "max": 16384, "step": 1}),
                "crop_height": ("INT", {"default": 512, "min": 1, "max": 16384, "step": 1}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "x", "y", "width", "height")
    FUNCTION = "crop"
    CATEGORY = "MoBo Nodes"

    def crop(self, image, crop_x, crop_y, crop_width, crop_height):
        # image shape: [B, H, W, C]
        img_h = image.shape[1]
        img_w = image.shape[2]

        # Clamp to image bounds
        x = max(0, min(crop_x, img_w - 1))
        y = max(0, min(crop_y, img_h - 1))
        w = max(1, min(crop_width, img_w - x))
        h = max(1, min(crop_height, img_h - y))

        # Crop
        cropped = image[:, y:y + h, x:x + w, :]

        # Mask: 1 inside crop region, 0 outside (on original dimensions)
        mask = torch.zeros((img_h, img_w), dtype=torch.float32, device="cpu")
        mask[y:y + h, x:x + w] = 1.0
        mask = mask.unsqueeze(0)  # [1, H, W]

        return (cropped, mask, x, y, w, h)

    @classmethod
    def IS_CHANGED(s, image, crop_x, crop_y, crop_width, crop_height):
        # Always re-execute when crop values change
        return f"{crop_x},{crop_y},{crop_width},{crop_height}"
