import os
import re


def resolve_template(template, variables):
    """
    Replace {variable} placeholders in the template with values from the variables dict.
    ComfyUI's native %tokens% (like %date:FORMAT% and %NodeName.widget%) pass through
    untouched — SaveImage resolves those downstream.
    Unknown or empty {variables} are replaced with empty string.
    """
    def replacer(match):
        key = match.group(1)
        val = variables.get(key, "")
        if val is None:
            return ""
        return str(val)

    # Only match {word} — not %percent% tokens
    result = re.sub(r"\{([^}]+)\}", replacer, template)
    return result


def clean_filename(s):
    """Clean up a composed filename: collapse separators, strip edges."""
    # Replace path separators with underscores
    s = s.replace("/", "_").replace("\\", "_")
    # Remove problematic chars
    s = re.sub(r'[<>:"|?*]', '', s)
    # Collapse multiple underscores/hyphens
    s = re.sub(r'_+', '_', s)
    s = re.sub(r'-+', '-', s)
    # Strip leading/trailing separators and whitespace
    s = s.strip('_- ')
    return s


class MoBo_FilenameBuilder:
    """
    Compose output filenames from input parts using a {variable} template.

    Template variables:
        {folder}   — folder input, path separators → underscores
        {name}     — filename input, extension stripped
        {ext}      — extension from filename (without dot)
        {prefix}   — prefix input
        {suffix}   — suffix input
        {width}    — width input (omitted if 0)
        {height}   — height input (omitted if 0)
        {res}      — shorthand for widthxheight (omitted if either is 0)

    ComfyUI native tokens like %date:yyyy_MM_dd% pass through unchanged
    for SaveImage to resolve.
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "template": ("STRING", {
                    "default": "{folder}_{name}",
                    "multiline": True,
                }),
            },
            "optional": {
                "folder": ("STRING", {"default": "", "forceInput": True}),
                "filename": ("STRING", {"default": "", "forceInput": True}),
                "prefix": ("STRING", {"default": "", "forceInput": True}),
                "suffix": ("STRING", {"default": "", "forceInput": True}),
                "width": ("INT", {"default": 0, "min": 0, "max": 16384, "forceInput": True}),
                "height": ("INT", {"default": 0, "min": 0, "max": 16384, "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("filename", "folder")
    FUNCTION = "build"
    CATEGORY = "MoBo Nodes"

    def build(self, template, folder=None, filename=None, prefix=None, suffix=None,
              width=None, height=None):
        if folder is None:
            folder = ""
        if filename is None:
            filename = ""
        if prefix is None:
            prefix = ""
        if suffix is None:
            suffix = ""
        if width is None:
            width = 0
        if height is None:
            height = 0

        # Derive name and extension from filename
        name, ext = os.path.splitext(filename)
        ext = ext.lstrip(".")

        # Clean folder: replace path separators with underscores
        folder_clean = folder.replace("/", "_").replace("\\", "_").strip("_")

        # Build resolution string
        res = f"{width}x{height}" if width > 0 and height > 0 else ""

        # Variable lookup
        variables = {
            "folder": folder_clean,
            "name": name,
            "ext": ext,
            "prefix": prefix,
            "suffix": suffix,
            "width": str(width) if width > 0 else "",
            "height": str(height) if height > 0 else "",
            "res": res,
        }

        # Resolve {variables} — %tokens% pass through for SaveImage
        result = resolve_template(template, variables)

        # Clean up (but preserve %tokens%)
        result = clean_filename(result)

        return (result, folder)
