from .nodes.image_loader import MoBo_FolderImageLoader
from .nodes.image_loader_plus import MoBo_ImageLoaderPlus
from .nodes.image_info import MoBo_ImageInfo
from .nodes.aspect_ratio import MoBo_AspectRatio
from .nodes.crop_to_ratio import MoBo_CropToRatio
from .nodes.interactive_crop import MoBo_InteractiveCrop
from .nodes.filename_builder import MoBo_FilenameBuilder
from .nodes.string_selector_plus import MoBo_StringSelectorPlus

NODE_CLASS_MAPPINGS = {
    "LoadImageFromFolder": MoBo_FolderImageLoader,
    "LoadImagePlus": MoBo_ImageLoaderPlus,
    "ImageInfo": MoBo_ImageInfo,
    "AspectRatio": MoBo_AspectRatio,
    "CropToRatio": MoBo_CropToRatio,
    "InteractiveCrop": MoBo_InteractiveCrop,
    "FilenameBuilder": MoBo_FilenameBuilder,
    "StringSelectorPlus": MoBo_StringSelectorPlus,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageFromFolder": "Load Image from Folder",
    "LoadImagePlus": "Load Image Plus",
    "ImageInfo": "Image Info",
    "AspectRatio": "Aspect Ratio",
    "CropToRatio": "Crop to Ratio",
    "InteractiveCrop": "Interactive Crop",
    "FilenameBuilder": "Filename Builder",
    "StringSelectorPlus": "String Selector Plus",
}

WEB_DIRECTORY = "./web/js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
