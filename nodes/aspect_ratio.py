import math


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


def snap_to_nearest_ratio(w, h):
    """Find the nearest standard ratio name for given dimensions."""
    if h == 0:
        return "1:1"
    actual = w / h
    best_name = "1:1"
    best_diff = float("inf")
    for name, (rw, rh) in STANDARD_RATIOS.items():
        diff = abs(actual - rw / rh)
        if diff < best_diff:
            best_diff = diff
            best_name = name
    return best_name


def compute_resolution(ratio_w, ratio_h, target_longest_side, divisible_by=8):
    """Compute width and height from ratio + target longest side, ensuring divisibility."""
    if ratio_w >= ratio_h:
        # Landscape or square: longest side is width
        w = target_longest_side
        h = round(w * ratio_h / ratio_w)
    else:
        # Portrait: longest side is height
        h = target_longest_side
        w = round(h * ratio_w / ratio_h)

    # Snap to divisible_by
    w = max(divisible_by, (w // divisible_by) * divisible_by)
    h = max(divisible_by, (h // divisible_by) * divisible_by)

    return w, h


class MoBo_AspectRatio:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "ratio": (RATIO_NAMES, {"default": "16:9"}),
                "target_longest_side": ("INT", {"default": 1280, "min": 64, "max": 8192, "step": 8}),
                "divisible_by": ("INT", {"default": 8, "min": 1, "max": 128, "step": 1}),
            },
            "optional": {
                "image": ("IMAGE",),
                "auto_snap": ("BOOLEAN", {"default": False}),
                "custom_ratio_w": ("INT", {"default": 16, "min": 1, "max": 100}),
                "custom_ratio_h": ("INT", {"default": 9, "min": 1, "max": 100}),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("ratio_string", "width", "height", "ratio_float")
    FUNCTION = "calc"
    CATEGORY = "MoBo Nodes"

    def calc(self, ratio, target_longest_side, divisible_by,
             image=None, auto_snap=False, custom_ratio_w=16, custom_ratio_h=9):

        # Step 1: Determine the ratio to use
        if auto_snap and image is not None:
            # Auto-detect from image and snap to nearest standard ratio
            img_h = image.shape[1]
            img_w = image.shape[2]
            matched = snap_to_nearest_ratio(img_w, img_h)
            rw, rh = STANDARD_RATIOS[matched]
            ratio_string = matched
        elif ratio == "Custom":
            rw = custom_ratio_w
            rh = custom_ratio_h
            g = math.gcd(rw, rh)
            ratio_string = f"{rw // g}:{rh // g}"
        else:
            rw, rh = STANDARD_RATIOS[ratio]
            ratio_string = ratio

        # Step 2: Compute resolution
        w, h = compute_resolution(rw, rh, target_longest_side, divisible_by)

        ratio_float = round(w / h, 4) if h > 0 else 0.0

        return (ratio_string, w, h, ratio_float)
