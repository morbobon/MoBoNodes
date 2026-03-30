import math
import torch


STANDARD_RATIOS = {
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
}

RATIO_NAMES = list(STANDARD_RATIOS.keys()) + ["Custom"]

ANCHOR_POSITIONS = ["center", "top-left", "top-center", "top-right",
                    "center-left", "center-right",
                    "bottom-left", "bottom-center", "bottom-right"]


def compute_crop(img_w, img_h, ratio_w, ratio_h, anchor):
    """Compute the largest crop region that fits the target ratio inside the image."""
    target_ratio = ratio_w / ratio_h

    if img_w / img_h > target_ratio:
        # Image is wider than target: crop width
        crop_h = img_h
        crop_w = round(img_h * target_ratio)
    else:
        # Image is taller than target: crop height
        crop_w = img_w
        crop_h = round(img_w / target_ratio)

    # Clamp
    crop_w = min(crop_w, img_w)
    crop_h = min(crop_h, img_h)

    # Compute anchor position
    remain_x = img_w - crop_w
    remain_y = img_h - crop_h

    # Horizontal
    if "left" in anchor:
        x = 0
    elif "right" in anchor:
        x = remain_x
    else:
        x = remain_x // 2

    # Vertical
    if "top" in anchor:
        y = 0
    elif "bottom" in anchor:
        y = remain_y
    else:
        y = remain_y // 2

    return x, y, crop_w, crop_h


class MoBo_CropToRatio:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "ratio": (RATIO_NAMES, {"default": "16:9"}),
                "anchor": (ANCHOR_POSITIONS, {"default": "center"}),
            },
            "optional": {
                "custom_ratio_w": ("INT", {"default": 16, "min": 1, "max": 100}),
                "custom_ratio_h": ("INT", {"default": 9, "min": 1, "max": 100}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "x", "y", "crop_width", "crop_height", "width", "height")
    FUNCTION = "crop"
    CATEGORY = "MoBo Nodes"

    def crop(self, image, ratio, anchor, custom_ratio_w=16, custom_ratio_h=9):
        # image shape: [B, H, W, C]
        img_h = image.shape[1]
        img_w = image.shape[2]

        # Determine ratio
        if ratio == "Custom":
            rw = custom_ratio_w
            rh = custom_ratio_h
        else:
            rw, rh = STANDARD_RATIOS[ratio]

        # Compute crop region
        x, y, crop_w, crop_h = compute_crop(img_w, img_h, rw, rh, anchor)

        # Crop the image: [B, H, W, C]
        cropped = image[:, y:y + crop_h, x:x + crop_w, :]

        # Create a full-size mask showing the crop region (1 = cropped area, 0 = outside)
        mask = torch.zeros((img_h, img_w), dtype=torch.float32, device="cpu")
        mask[y:y + crop_h, x:x + crop_w] = 1.0
        mask = mask.unsqueeze(0)  # [1, H, W]

        return (cropped, mask, x, y, crop_w, crop_h, cropped.shape[2], cropped.shape[1])
