import os
import re
from datetime import datetime


def resolve_template(template, variables):
    """
    Replace {variable} placeholders in the template with values from the variables dict.
    Supports {date:FORMAT} for strftime formatting.
    Unknown or empty variables are replaced with empty string.
    """
    now = datetime.now()

    def replacer(match):
        key = match.group(1)

        # Handle {date:FORMAT} — strftime pattern
        if key.startswith("date:"):
            fmt = key[5:]
            return now.strftime(fmt)

        # Handle {time:FORMAT}
        if key.startswith("time:"):
            fmt = key[5:]
            return now.strftime(fmt)

        # Lookup in variables
        val = variables.get(key, "")
        if val is None:
            return ""
        return str(val)

    # Match {word} or {word:anything}
    result = re.sub(r"\{([^}]+)\}", replacer, template)
    return result


def clean_filename(s):
    """Remove characters that are problematic in filenames."""
    # Replace path separators with underscores
    s = s.replace("/", "_").replace("\\", "_")
    # Remove other problematic chars
    s = re.sub(r'[<>:"|?*]', '', s)
    # Collapse multiple underscores
    s = re.sub(r'_+', '_', s)
    # Strip leading/trailing underscores
    s = s.strip('_')
    return s


class MoBo_FilenameBuilder:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "template": ("STRING", {
                    "default": "{folder}_{name}_{date}",
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

        now = datetime.now()

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
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H-%M-%S"),
        }

        # Resolve the template
        result = resolve_template(template, variables)

        # Clean up the result
        result = clean_filename(result)

        return (result, folder)
