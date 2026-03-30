import torch


STANDARD_RATIOS = {
    "Freeform":  None,
    "1:1":   (1, 1),
    "4:3":   (4, 3),
    "3:4":   (3, 4),
    "5:4":   (5, 4),
    "4:5":   (4, 5),
    "3:2":   (3, 2),
    "2:3":   (2, 3),
    "16:9":  (16, 9),
    "9:16":  (9, 16),
    "16:10": (16, 10),
    "10:16": (10, 16),
    "21:9":  (21, 9),
    "9:21":  (9, 21),
    "2:1":   (2, 1),
    "1:2":   (1, 2),
    "Custom": None,
}

RATIO_NAMES = list(STANDARD_RATIOS.keys())


class MoBo_InteractiveCrop:
    """
    Interactive crop node with a visual popup editor.
    The crop region is selected at edit time via a JS popup overlay.
    Supports ratio locking via built-in dropdown or external ratio input.
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "ratio": (RATIO_NAMES, {"default": "Freeform"}),
                "crop_x": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_y": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_width": ("INT", {"default": 512, "min": 1, "max": 16384, "step": 1}),
                "crop_height": ("INT", {"default": 512, "min": 1, "max": 16384, "step": 1}),
            },
            "optional": {
                "ratio_override": ("STRING", {"default": "", "forceInput": True}),
                "custom_ratio_w": ("INT", {"default": 16, "min": 1, "max": 100}),
                "custom_ratio_h": ("INT", {"default": 9, "min": 1, "max": 100}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "x", "y", "width", "height")
    FUNCTION = "crop"
    CATEGORY = "MoBo Nodes"

    def crop(self, image, ratio, crop_x, crop_y, crop_width, crop_height,
             ratio_override="", custom_ratio_w=16, custom_ratio_h=9):
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
    def IS_CHANGED(s, image, ratio, crop_x, crop_y, crop_width, crop_height, **kwargs):
        return f"{crop_x},{crop_y},{crop_width},{crop_height}"
