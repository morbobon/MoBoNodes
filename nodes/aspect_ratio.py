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

RATIO_NAMES = list(STANDARD_RATIOS.keys()) + ["Custom", "From input"]


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


def compute_resolution(ratio_w, ratio_h, target_side, divisible_by=8, longest_side=False):
    """Compute width and height from a ratio + a target pixel count for one side.

    If `longest_side` is False (default), `target_side` is the SHORT side.
    If True, it's the LONG side. The other dimension is derived from the
    aspect ratio. Both outputs are rounded down to the nearest multiple of
    `divisible_by` (with a floor of `divisible_by`).
    """
    portrait = ratio_w <= ratio_h
    if longest_side:
        # The longer side gets the target pixel count
        if portrait:
            h = target_side
            w = round(h * ratio_w / ratio_h)
        else:
            w = target_side
            h = round(w * ratio_h / ratio_w)
    else:
        # Short-side mode (legacy default)
        if portrait:
            w = target_side
            h = round(w * ratio_h / ratio_w)
        else:
            h = target_side
            w = round(h * ratio_w / ratio_h)

    w = max(divisible_by, (w // divisible_by) * divisible_by)
    h = max(divisible_by, (h // divisible_by) * divisible_by)

    return w, h


class MoBo_AspectRatio:
    """Compute width/height from an aspect ratio and a target short-side resolution."""

    DESCRIPTION = "Compute output dimensions from an aspect ratio + target short-side pixel count. Supports 'From input' mode that derives the ratio from a connected image, plus manual override."

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "ratio": (RATIO_NAMES, {"default": "16:9",
                    "tooltip": "Aspect ratio. Standard names (16:9, 4:3, …), 'Custom' (uses custom_ratio_w/h), or 'From input' (derived from connected image or input_width/height)."}),
                "target_short_side": ("INT", {"default": 720, "min": 64, "max": 8192, "step": 8,
                    "tooltip": "Pixel count for the SHORTER output dimension. Matches video conventions — 720 at 16:9 gives 1280×720."}),
                "divisible_by": ("INT", {"default": 8, "min": 1, "max": 128, "step": 1,
                    "tooltip": "Round both output dims DOWN to this multiple. Default 8 matches most diffusion models."}),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "Source image (used with 'From input' and 'auto_snap')."}),
                "input_width":  ("INT", {"default": 0, "min": 0, "max": 16384, "forceInput": True,
                    "tooltip": "Alternative to image: source width as an int."}),
                "input_height": ("INT", {"default": 0, "min": 0, "max": 16384, "forceInput": True,
                    "tooltip": "Alternative to image: source height as an int."}),
                "auto_snap": ("BOOLEAN", {"default": False,
                    "tooltip": "If true, snap the source dimensions to the nearest standard ratio before computing output."}),
                "custom_ratio_w": ("INT", {"default": 16, "min": 1, "max": 100,
                    "tooltip": "Custom ratio width component (used when ratio = 'Custom')."}),
                "custom_ratio_h": ("INT", {"default": 9, "min": 1, "max": 100,
                    "tooltip": "Custom ratio height component (used when ratio = 'Custom')."}),
                "output_width":  ("INT", {"default": 0, "min": 0, "max": 16384,
                    "tooltip": "Manual override for output width. Both this and output_height must be > 0 to take effect; set to 0 for automatic."}),
                "output_height": ("INT", {"default": 0, "min": 0, "max": 16384,
                    "tooltip": "Manual override for output height. Paired with output_width."}),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("ratio_string", "width", "height", "ratio_float")
    OUTPUT_TOOLTIPS = (
        "The ratio actually used, e.g. '16:9'. May differ from the 'ratio' input when 'From input' or 'auto_snap' was applied.",
        "Final output width.",
        "Final output height.",
        "width / height as a float, rounded to 4 decimals.",
    )
    FUNCTION = "calc"
    CATEGORY = "MoBo Nodes"

    def calc(self, ratio, target_short_side, divisible_by,
             image=None, input_width=None, input_height=None,
             auto_snap=False, custom_ratio_w=None, custom_ratio_h=None,
             output_width=None, output_height=None):
        if input_width is None:
            input_width = 0
        if input_height is None:
            input_height = 0
        if custom_ratio_w is None:
            custom_ratio_w = 16
        if custom_ratio_h is None:
            custom_ratio_h = 9
        if output_width is None:
            output_width = 0
        if output_height is None:
            output_height = 0

        # Step 1: Determine source dimensions (image takes priority over raw ints)
        src_w, src_h = 0, 0
        if image is not None:
            src_w = image.shape[2]
            src_h = image.shape[1]
        elif input_width > 0 and input_height > 0:
            src_w = input_width
            src_h = input_height

        # Step 2: Determine the ratio to use
        if ratio == "From input" and src_w > 0 and src_h > 0:
            # Use the exact ratio from the input dimensions
            if auto_snap:
                # Snap to nearest standard ratio
                matched = snap_to_nearest_ratio(src_w, src_h)
                rw, rh = STANDARD_RATIOS[matched]
                ratio_string = matched
            else:
                # Use exact input ratio
                g = math.gcd(src_w, src_h)
                rw = src_w // g
                rh = src_h // g
                ratio_string = f"{rw}:{rh}"
        elif auto_snap and src_w > 0 and src_h > 0:
            # Any ratio mode + auto_snap + source available: snap source to nearest
            matched = snap_to_nearest_ratio(src_w, src_h)
            rw, rh = STANDARD_RATIOS[matched]
            ratio_string = matched
        elif ratio == "Custom":
            rw = custom_ratio_w
            rh = custom_ratio_h
            g = math.gcd(rw, rh)
            ratio_string = f"{rw // g}:{rh // g}"
        elif ratio == "From input":
            # No source connected, fall back to 1:1
            rw, rh = 1, 1
            ratio_string = "1:1"
        else:
            rw, rh = STANDARD_RATIOS[ratio]
            ratio_string = ratio

        # Step 3: Compute resolution
        w, h = compute_resolution(rw, rh, target_short_side, divisible_by)

        # Step 4: Allow manual override via output_width/output_height
        if output_width > 0 and output_height > 0:
            w = output_width
            h = output_height

        ratio_float = round(w / h, 4) if h > 0 else 0.0

        return (ratio_string, w, h, ratio_float)
