"""Keyword-gated, dual high/low LoRA stacker for Wan 2.2-style workflows.

Builds two standard LORA_STACKs (one for the high-noise model, one for the low)
from a dynamic, arbitrary number of LoRA "rows". Each row carries:
  - a high-model LoRA file + strength
  - a low-model LoRA file + strength
  - an optional `keyword` trigger
  - an on/off toggle

A row's entries are added to the stacks only if the row is toggled on AND its
keyword is found in the incoming `prompt` (case-insensitive substring). A blank
keyword means "always on"; comma-separated keywords act as OR triggers.

This is the per-segment primitive for a chained i2v pipeline: define your
keyword -> LoRA library once, feed each segment its own prompt, and the right
combination self-selects into the stacks. Pair with MoBo_ApplyKeywordLoraStack
to patch the models. Optional incoming stacks are concatenated (and passed
through untouched when nothing matches) so multiple stackers chain cleanly --
unlike toggle-off rows that silently drop the upstream stack in some other packs.

The LORA_STACK format is the de-facto standard list of
(lora_name, strength_model, strength_clip) tuples, so the outputs interoperate
with other stack-aware nodes too.

Dynamic-row mechanism adapted from rgthree-comfy's Power Lora Loader (MIT).
"""

import re

from .flexible_input import any_type, FlexibleOptionalInputType


def _keyword_matches(keyword: str, prompt_lower: str) -> bool:
    """True if any of the row's keywords appear in the prompt (case-insensitive OR).

    Multiple keywords may be separated by comma, semicolon, or newline. A blank
    keyword means "always on". Matching is case-insensitive substring matching.
    """
    keyword = (keyword or "").strip()
    if not keyword:
        return True  # blank == always on
    parts = [p.strip().lower() for p in re.split(r"[,;\n]", keyword) if p.strip()]
    if not parts:
        return True
    return any(p in prompt_lower for p in parts)


def _row_index(key: str) -> int:
    try:
        return int(key.split("_", 1)[1])
    except (IndexError, ValueError):
        return 0


def _to_float(value, default=1.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class MoBo_KeywordLoraStacker:
    """Build keyword-gated high/low LORA_STACKs from a dynamic list of rows."""

    DESCRIPTION = (
        "Build two LORA_STACKs (high + low) from an arbitrary number of LoRA "
        "rows, each gated by optional keyword(s) matched against the prompt "
        "(case-insensitive; blank = always on; separate multiple with , ; or "
        "newline for OR). Feed each segment of a chained i2v "
        "workflow its own prompt and the right LoRAs self-select. Chain stackers "
        "via the optional stack inputs (concatenated, passed through when nothing "
        "matches). Apply with MoBo_ApplyKeywordLoraStack."
    )

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "tooltip": "Scanned for each row's keyword(s), case-insensitive. Passed through unchanged on the 'prompt' output.",
                }),
                "stack_keyword": ("STRING", {
                    "default": "",
                    "tooltip": "Node-level gate. Blank = always active. If set, NONE of the rows apply unless this matches the prompt "
                               "(case-insensitive; , ; or newline = OR). When it doesn't match, incoming stacks pass through unchanged.",
                }),
            },
            # Seeded optional stack inputs render as real LORA_STACK sockets;
            # the frontend also injects lora_1, lora_2, ... here.
            "optional": FlexibleOptionalInputType(any_type, data={
                "lora_stack_high": ("LORA_STACK", {"tooltip": "Optional upstream high stack; matched rows are appended to it."}),
                "lora_stack_low": ("LORA_STACK", {"tooltip": "Optional upstream low stack; matched rows are appended to it."}),
            }),
            "hidden": {},
        }

    RETURN_TYPES = ("LORA_STACK", "LORA_STACK", "STRING", "STRING")
    RETURN_NAMES = ("lora_stack_high", "lora_stack_low", "prompt", "loaded")
    OUTPUT_TOOLTIPS = (
        "High-model LoRA stack: list of (name, strength, strength) tuples.",
        "Low-model LoRA stack: list of (name, strength, strength) tuples.",
        "The prompt, passed through unchanged (thread it through the segment).",
        "Newline list of which LoRAs were stacked this run (debug / filename use).",
    )
    FUNCTION = "build"
    CATEGORY = "MoBo Nodes"

    def build(self, prompt="", stack_keyword="", lora_stack_high=None, lora_stack_low=None, **kwargs):
        if isinstance(prompt, (list, tuple)):
            prompt = prompt[0] if prompt else ""
        prompt_lower = (prompt or "").lower()

        high = list(lora_stack_high) if lora_stack_high else []
        low = list(lora_stack_low) if lora_stack_low else []

        # Node-level gate: if a stack keyword is set and not present in the
        # prompt, skip every row and pass the incoming stacks through unchanged.
        if not _keyword_matches(stack_keyword, prompt_lower):
            return (high, low, prompt, "(stack keyword not matched)")

        rows = []
        for key, val in kwargs.items():
            if key.startswith("lora_") and isinstance(val, dict):
                rows.append((_row_index(key), val))
        rows.sort(key=lambda x: x[0])

        loaded_names = []
        for _, row in rows:
            if not row.get("on", True):
                continue
            if not _keyword_matches(row.get("keyword", ""), prompt_lower):
                continue

            lora_high = row.get("lora_high") or "None"
            lora_low = row.get("lora_low") or "None"
            str_high = _to_float(row.get("strengthHigh", 1.0))
            str_low = _to_float(row.get("strengthLow", 1.0))

            fired = False
            if lora_high != "None" and str_high != 0:
                # (name, strength_model, strength_clip). Wan LoRAs are model-only;
                # clip mirrors model so the tuple stays interoperable with other
                # stack-aware nodes that do patch clip.
                high.append((lora_high, str_high, str_high))
                fired = True
            if lora_low != "None" and str_low != 0:
                low.append((lora_low, str_low, str_low))
                fired = True

            if fired:
                kw = (row.get("keyword") or "").strip()
                tag = f" ['{kw}']" if kw else ""
                loaded_names.append(f"H:{lora_high}@{str_high} L:{lora_low}@{str_low}{tag}")

        loaded = "\n".join(loaded_names) if loaded_names else "(none matched)"
        return (high, low, prompt, loaded)

    @classmethod
    def IS_CHANGED(s, prompt="", stack_keyword="", lora_stack_high=None, lora_stack_low=None, **kwargs):
        import json
        rows = {k: v for k, v in kwargs.items() if k.startswith("lora_")}
        try:
            return (
                f"{prompt}::{stack_keyword}::{json.dumps(rows, sort_keys=True, default=str)}"
                f"::{lora_stack_high}::{lora_stack_low}"
            )
        except Exception:
            return float("nan")
