from .nodes.image_loader import MoBo_FolderImageLoader
from .nodes.image_info import MoBo_ImageInfo
from .nodes.aspect_ratio import MoBo_AspectRatio
from .nodes.crop_to_ratio import MoBo_CropToRatio
from .nodes.interactive_crop import MoBo_InteractiveCrop
from .nodes.filename_builder import MoBo_FilenameBuilder

NODE_CLASS_MAPPINGS = {
    "LoadImageFromFolder": MoBo_FolderImageLoader,
    "MoBo_LoadImageFromFolder": MoBo_FolderImageLoader,  # backward compat
    "MoBo_FolderImageLoader": MoBo_FolderImageLoader,  # backward compat
    "FolderImageLoader": MoBo_FolderImageLoader,  # backward compat
    "MoBo_ImageInfo": MoBo_ImageInfo,
    "MoBo_AspectRatio": MoBo_AspectRatio,
    "MoBo_CropToRatio": MoBo_CropToRatio,
    "MoBo_InteractiveCrop": MoBo_InteractiveCrop,
    "MoBo_FilenameBuilder": MoBo_FilenameBuilder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageFromFolder": "Load Image from Folder",
    "MoBo_LoadImageFromFolder": "Load Image from Folder",  # backward compat
    "MoBo_FolderImageLoader": "Load Image from Folder",  # backward compat
    "FolderImageLoader": "Load Image from Folder",  # backward compat
    "MoBo_ImageInfo": "Image Info",
    "MoBo_AspectRatio": "Aspect Ratio",
    "MoBo_CropToRatio": "Crop to Ratio",
    "MoBo_InteractiveCrop": "Interactive Crop",
    "MoBo_FilenameBuilder": "Filename Builder",
}

WEB_DIRECTORY = "./web/js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
