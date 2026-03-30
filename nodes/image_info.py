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
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("INT", "INT", "FLOAT", "STRING", "STRING", "STRING", "FLOAT")
    RETURN_NAMES = ("width", "height", "ratio_float", "closest_ratio", "exact_ratio", "orientation", "megapixels")
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
