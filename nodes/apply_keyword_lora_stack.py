"""Apply dual high/low LORA_STACKs onto Wan 2.2-style models (+ optional clip).

The dumb counterpart to MoBo_KeywordLoraStacker: takes the high and low models
(and optionally the clip / text encoder) plus their LORA_STACKs and patches them.

  - model_high is patched with lora_stack_high (model weights only)
  - model_low  is patched with lora_stack_low  (model weights only)
  - clip, if provided, is patched ONCE per unique LoRA across both stacks
    (deduped by name) using that entry's clip strength. There are two models but
    only one text encoder, and a LoRA's text-encoder delta is the same regardless
    of the high/low noise split, so applying it once avoids double-patching.

Because each call patches fresh clones, feeding the same untouched base
model_high / model_low / clip into every segment of a chained i2v workflow gives
fully independent per-segment LoRA combinations with no accumulation.

Accepts the standard LORA_STACK format -- a list of
(lora_name, strength_model, strength_clip) tuples -- so stacks from other
stack-aware nodes work here too.
"""

import folder_paths
import comfy.utils
import comfy.sd


# Cache loaded state-dicts so repeated runs / multiple segments don't re-read
# the same LoRA from disk. Model patching (clone + add_patches) still runs each call.
_LORA_CACHE: dict = {}


def _load_lora_tensors(lora_name: str):
    if not lora_name or lora_name == "None":
        return None
    cached = _LORA_CACHE.get(lora_name)
    if cached is not None:
        return cached
    path = folder_paths.get_full_path("loras", lora_name)
    if path is None:
        print(f"[MoBo ApplyKeywordLoraStack] LoRA not found: {lora_name}")
        return None
    data = comfy.utils.load_torch_file(path, safe_load=True)
    _LORA_CACHE[lora_name] = data
    return data


def _entry(entry):
    """Normalize a stack entry to (name, strength_model, strength_clip)."""
    name = entry[0]
    sm = float(entry[1]) if len(entry) > 1 else 1.0
    sc = float(entry[2]) if len(entry) > 2 else sm
    return name, sm, sc


def _apply_stack_model_only(model, stack):
    """Patch `model` with every entry in `stack` (model weights only)."""
    if model is None or not stack:
        return model
    for raw in stack:
        if not raw:
            continue
        name, sm, _sc = _entry(raw)
        if sm == 0 or not name or name == "None":
            continue
        lora = _load_lora_tensors(name)
        if lora is None:
            continue
        model, _ = comfy.sd.load_lora_for_models(model, None, lora, sm, 0)
    return model


def _apply_clip_dedup(clip, *stacks):
    """Patch `clip` once per unique LoRA across all stacks (clip weights only)."""
    if clip is None:
        return clip
    seen = set()
    for stack in stacks:
        if not stack:
            continue
        for raw in stack:
            if not raw:
                continue
            name, _sm, sc = _entry(raw)
            if not name or name == "None" or name in seen:
                continue
            seen.add(name)
            if sc == 0:
                continue
            lora = _load_lora_tensors(name)
            if lora is None:
                continue
            _, clip = comfy.sd.load_lora_for_models(None, clip, lora, 0, sc)
    return clip


class MoBo_ApplyKeywordLoraStack:
    """Apply high/low LORA_STACKs onto the high/low models (and optional clip)."""

    DESCRIPTION = (
        "Patch model_high with lora_stack_high and model_low with lora_stack_low "
        "(model-only). If a clip is connected it is patched once per unique LoRA "
        "across both stacks (a LoRA's text-encoder delta is shared, so it is not "
        "double-applied). Pairs with MoBo_KeywordLoraStacker. Patches fresh "
        "clones, so the same base inputs can drive many independent segments."
    )

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model_high": ("MODEL", {"tooltip": "Base high-noise model. Patched onto a fresh clone."}),
                "model_low": ("MODEL", {"tooltip": "Base low-noise model. Patched onto a fresh clone."}),
            },
            "optional": {
                "clip": ("CLIP", {"tooltip": "Optional text encoder. Patched once per unique LoRA (clip weights only). Passed through if no LoRA touches it."}),
                "lora_stack_high": ("LORA_STACK", {"tooltip": "Stack applied to model_high. Empty/none = passthrough."}),
                "lora_stack_low": ("LORA_STACK", {"tooltip": "Stack applied to model_low. Empty/none = passthrough."}),
            },
        }

    RETURN_TYPES = ("MODEL", "MODEL", "CLIP")
    RETURN_NAMES = ("model_high", "model_low", "clip")
    OUTPUT_TOOLTIPS = (
        "High-noise model with the high stack applied.",
        "Low-noise model with the low stack applied.",
        "Clip patched with the deduped union of both stacks (or passthrough).",
    )
    FUNCTION = "apply"
    CATEGORY = "MoBo Nodes"

    def apply(self, model_high, model_low, clip=None, lora_stack_high=None, lora_stack_low=None):
        model_high = _apply_stack_model_only(model_high, lora_stack_high)
        model_low = _apply_stack_model_only(model_low, lora_stack_low)
        clip = _apply_clip_dedup(clip, lora_stack_high, lora_stack_low)
        return (model_high, model_low, clip)
