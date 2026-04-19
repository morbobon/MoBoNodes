import torch


class MoBo_InteractiveCrop:
    """Visually crop a connected image via a full-screen popup editor."""

    DESCRIPTION = "Click 'Show & Edit Image' to pick a crop region visually. Apply writes the selection to the crop_x/y/width/height inputs. Source image must come from a node that exposes a file (LoadImage, Load Image Plus, …)."

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Image to crop. Must come from a node that exposes a file on disk so the editor can fetch it via /view."}),
                "crop_x": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1,
                    "tooltip": "Left edge of crop region in original pixel coordinates. Auto-filled by the popup's Apply button."}),
                "crop_y": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1,
                    "tooltip": "Top edge of crop region in original pixel coordinates."}),
                "crop_width":  ("INT", {"default": 512, "min": 1, "max": 16384, "step": 1,
                    "tooltip": "Width of crop region in pixels."}),
                "crop_height": ("INT", {"default": 512, "min": 1, "max": 16384, "step": 1,
                    "tooltip": "Height of crop region in pixels."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "x", "y", "width", "height")
    OUTPUT_TOOLTIPS = (
        "Cropped image tensor.",
        "Mask at original image size: 1 inside the crop region, 0 outside.",
        "Actual x used after clamping to image bounds.",
        "Actual y used after clamping to image bounds.",
        "Actual crop width after clamping.",
        "Actual crop height after clamping.",
    )
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
        return f"{crop_x},{crop_y},{crop_width},{crop_height}"
