import math


# Standard aspect ratios for display purposes
STANDARD_RATIOS = [
    (1, 1),
    (4, 3), (3, 4),
    (5, 4), (4, 5),
    (3, 2), (2, 3),
    (16, 9), (9, 16),
    (16, 10), (10, 16),
    (21, 9), (9, 21),
    (2, 1), (1, 2),
]


def find_closest_standard_ratio(w, h):
    """Find the closest standard aspect ratio for given dimensions."""
    if h == 0:
        return "N/A"
    actual = w / h
    best_name = None
    best_diff = float("inf")
    for rw, rh in STANDARD_RATIOS:
        diff = abs(actual - rw / rh)
        if diff < best_diff:
            best_diff = diff
            best_name = f"{rw}:{rh}"
    return best_name


def exact_ratio_string(w, h):
    """Get the exact simplified ratio string using GCD."""
    if h == 0:
        return "N/A"
    g = math.gcd(w, h)
    return f"{w // g}:{h // g}"


class MoBo_ImageInfo:
    """Extract dimensions, ratio, orientation, and megapixels from an image tensor."""

    DESCRIPTION = "Return dimensions, aspect ratio, orientation, and megapixels of an image. Useful for conditional routing or composing filenames."

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Image to inspect."}),
            },
        }

    RETURN_TYPES = ("INT", "INT", "FLOAT", "STRING", "STRING", "STRING", "FLOAT")
    RETURN_NAMES = ("width", "height", "ratio_float", "closest_ratio", "exact_ratio", "orientation", "megapixels")
    OUTPUT_TOOLTIPS = (
        "Width in pixels.",
        "Height in pixels.",
        "width / height as a float, rounded to 4 decimals (e.g. 1.7778 for 16:9).",
        "Nearest standard ratio name (e.g. '16:9', '4:3', '1:1').",
        "Exact GCD-simplified ratio (e.g. 1920×1080 → '16:9'; coprime dims stay as-is).",
        "'landscape', 'portrait', or 'square'.",
        "(width × height) / 1,000,000, rounded to 2 decimals.",
    )
    FUNCTION = "get_info"
    CATEGORY = "MoBo Nodes"

    def get_info(self, image):
        # image shape: [B, H, W, C]
        h = image.shape[1]
        w = image.shape[2]

        ratio_float = round(w / h, 4) if h > 0 else 0.0
        closest = find_closest_standard_ratio(w, h)
        exact = exact_ratio_string(w, h)
        megapixels = round((w * h) / 1_000_000, 2)

        if w > h:
            orientation = "landscape"
        elif h > w:
            orientation = "portrait"
        else:
            orientation = "square"

        return (w, h, ratio_float, closest, exact, orientation, megapixels)
