def parse_lines(text):
    """Split a multiline blob into a list of non-empty lines (whitespace-trimmed)."""
    if text is None:
        return []
    return [ln.strip() for ln in str(text).splitlines() if ln.strip()]


class MoBo_StringSelectorPlus:
    """Pick one line from a multiline list. Outputs the line and the resolved index.

    A small extension of the Impact Pack 'String Selector' concept: in addition
    to returning the chosen string, we also return the resolved index (so it
    can drive downstream Text Index Switches in lockstep) and we keep a hidden
    'selected' widget in sync with the chosen line so it can be referenced
    from SaveImage's filename_prefix as %StringSelectorPlus.selected%.
    """

    DESCRIPTION = (
        "Pick one line from a multiline list. Outputs the line, the resolved "
        "index (with wrap), and exposes the chosen line as a widget so "
        "%StringSelectorPlus.selected% works in SaveImage's filename_prefix. "
        "Wire 'index' into one or more EasyUse 'Text Index Switch' nodes to "
        "swap parallel prompt variants in lockstep."
    )

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # `select` first so it renders above the (potentially tall)
                # multiline strings textarea — otherwise the INT widget gets
                # buried and is hard to spot.
                "select": ("INT", {
                    "default": 0, "min": 0, "max": 0xFFFFFFFF, "step": 1,
                    "tooltip":
                        "Index of the entry to pick (zero-based). Wraps with "
                        "modulo if it exceeds the entry count.",
                }),
                "strings": ("STRING", {
                    "multiline": True,
                    "tooltip":
                        "One entry per line. Blank lines are skipped. Use "
                        "filename-safe names if you intend to reference "
                        "%StringSelectorPlus.selected% in SaveImage's "
                        "filename_prefix.",
                }),
            },
            "optional": {
                "selected": ("STRING", {
                    "default": "",
                    "tooltip":
                        "Auto-computed copy of the currently selected line "
                        "(hidden — kept in sync client-side). Reference as "
                        "%StringSelectorPlus.selected% in SaveImage's "
                        "filename_prefix to embed the variant label in the "
                        "saved filename.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("string", "index")
    OUTPUT_TOOLTIPS = (
        "The chosen line (verbatim, whitespace-trimmed).",
        "The resolved index after wrap. Wire this into EasyUse 'Text Index "
        "Switch' nodes to switch parallel prompt variants in lockstep.",
    )
    FUNCTION = "select_string"
    CATEGORY = "MoBo Nodes"

    def select_string(self, strings, select, selected=""):
        del selected  # UI-only mirror; ignored on the Python side
        lines = parse_lines(strings)
        if not lines:
            return ("", 0)
        i = select % len(lines)
        return (lines[i], i)

    @classmethod
    def IS_CHANGED(s, strings, select, selected=""):
        return f"{hash(strings)}|{select}"
