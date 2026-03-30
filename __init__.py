from .nodes.image_loader import MoBo_FolderImageLoader
from .nodes.image_info import MoBo_ImageInfo
from .nodes.aspect_ratio import MoBo_AspectRatio
from .nodes.crop_to_ratio import MoBo_CropToRatio
from .nodes.interactive_crop import MoBo_InteractiveCrop

NODE_CLASS_MAPPINGS = {
    "MoBo_FolderImageLoader": MoBo_FolderImageLoader,
    "FolderImageLoader": MoBo_FolderImageLoader,  # backward compat with old workflows
    "MoBo_ImageInfo": MoBo_ImageInfo,
    "MoBo_AspectRatio": MoBo_AspectRatio,
    "MoBo_CropToRatio": MoBo_CropToRatio,
    "MoBo_InteractiveCrop": MoBo_InteractiveCrop,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MoBo_FolderImageLoader": "Load Image from Folder",
    "FolderImageLoader": "Load Image from Folder",  # backward compat
    "MoBo_ImageInfo": "Image Info",
    "MoBo_AspectRatio": "Aspect Ratio",
    "MoBo_CropToRatio": "Crop to Ratio",
    "MoBo_InteractiveCrop": "Interactive Crop",
}

WEB_DIRECTORY = "./web/js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
