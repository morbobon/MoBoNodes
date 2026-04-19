import os
import re

from .aspect_ratio import snap_to_nearest_ratio


def resolve_template(template, variables):
    """Replace {variable} placeholders with values; %tokens% pass through untouched."""
    def replacer(match):
        key = match.group(1)
        val = variables.get(key, "")
        if val is None:
            return ""
        return str(val)
    return re.sub(r"\{([^}]+)\}", replacer, template)


def clean_filename(s):
    """Light cleanup for a composed filename. Preserves every char the user typed
    (including ':' for %date:FORMAT% tokens). Only normalizes '\\' → '/',
    collapses consecutive /_- runs, and trims edges."""
    s = s.replace("\\", "/")
    s = re.sub(r'/+', '/', s)
    s = re.sub(r'_+', '_', s)
    s = re.sub(r'-+', '-', s)
    s = s.strip('/_- ')
    return s


def clean_folder(s):
    """Same as clean_filename for now — folder output also preserves user-typed chars."""
    return clean_filename(s)


def compute_aspect(width, height):
    """Return filename-safe aspect ratio (e.g. '16x9') snapped to nearest standard, or ''."""
    if not width or not height or width <= 0 or height <= 0:
        return ""
    return snap_to_nearest_ratio(width, height).replace(":", "x")


class MoBo_FilenameBuilder:
    """Compose filename and folder outputs from {variable} templates."""

    DESCRIPTION = "Compose a filename AND an output folder from {variable} templates. All inputs are editable widgets; right-click to convert any widget into an input socket. ComfyUI-native %date:…% / %Node.output% tokens pass through for SaveImage to resolve."

    @classmethod
    def INPUT_TYPES(s):
        variables_help = (
            "Variables: {folder}, {filename} (ext stripped), {ext}, {fileid}, "
            "{prefix}, {suffix}, {width}, {height}, {res} (WxH), "
            "{aspect} (nearest standard, e.g. '16x9'). "
            "%tokens% pass through unchanged."
        )
        return {
            "required": {
                "filename_template": ("STRING", {
                    "default": "{fileid}_{aspect}",
                    "multiline": True,
                    "tooltip":
                        "Template for the filename output. " + variables_help +
                        " Every char you type is preserved (including ':' inside %date:...% tokens). "
                        "Only '\\' is normalized to '/' and consecutive /_- runs are collapsed.",
                }),
                "folder_template": ("STRING", {
                    "default": "{folder}",
                    "multiline": True,
                    "tooltip":
                        "Template for the folder output. " + variables_help +
                        " Cleaning is the same as the filename template — every typed char preserved.",
                }),
            },
            "optional": {
                "folder":   ("STRING", {"default": "",
                    "tooltip": "Folder name. Available as {folder} in templates; path separators preserved."}),
                "filename": ("STRING", {"default": "",
                    "tooltip": "Source filename. Extension is stripped for {filename}; bare extension available as {ext}."}),
                "fileid":  ("STRING", {"default": "",
                    "tooltip": "Short heuristic id (e.g. from Load Image Plus). Available as {fileid}."}),
                "prefix":   ("STRING", {"default": "",
                    "tooltip": "Prefix fragment. Available as {prefix}."}),
                "suffix":   ("STRING", {"default": "",
                    "tooltip": "Suffix fragment. Available as {suffix}."}),
                "width":    ("INT",    {"default": 0, "min": 0, "max": 16384,
                    "tooltip": "Width in pixels. 0 = empty string in substitution. Used by {width}, {res}, and {aspect}."}),
                "height":   ("INT",    {"default": 0, "min": 0, "max": 16384,
                    "tooltip": "Height in pixels. 0 = empty string in substitution. Used by {height}, {res}, and {aspect}."}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("filename", "folder")
    OUTPUT_TOOLTIPS = (
        "Composed and sanitized filename from filename_template. Safe to pass to SaveImage's filename_prefix.",
        "Composed folder path from folder_template. Nested folders ('/') preserved for routing to SaveImage's output dir or similar.",
    )
    FUNCTION = "build"
    CATEGORY = "MoBo Nodes"

    def build(self, filename_template, folder_template,
              folder="", filename="", fileid="",
              prefix="", suffix="", width=0, height=0):
        # Coerce Nones → defaults
        folder   = folder   or ""
        filename = filename or ""
        fileid  = fileid  or ""
        prefix   = prefix   or ""
        suffix   = suffix   or ""
        width    = width    or 0
        height   = height   or 0

        # Derive name/extension from source filename
        name, ext = os.path.splitext(filename)
        ext = ext.lstrip(".")

        res    = f"{width}x{height}" if width > 0 and height > 0 else ""
        aspect = compute_aspect(width, height)

        variables = {
            "folder":   folder,     # raw — path separators preserved for folder templates
            "filename": name,       # preferred name: extension-stripped stem
            "name":     name,       # backward-compat alias
            "ext":      ext,
            "fileid":  fileid,
            "prefix":   prefix,
            "suffix":   suffix,
            "width":    str(width) if width > 0 else "",
            "height":   str(height) if height > 0 else "",
            "res":      res,
            "aspect":   aspect,
        }

        filename_result = clean_filename(resolve_template(filename_template, variables))
        folder_result   = clean_folder(resolve_template(folder_template, variables))

        return (filename_result, folder_result)
