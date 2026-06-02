"""Flexible optional input type for dynamic, frontend-injected node inputs.

Adapted from rgthree-comfy's Power Lora Loader (MIT License,
Copyright (c) Regis Gaughan, III). Lets a node accept an arbitrary number of
arbitrarily-named inputs (e.g. lora_1, lora_2, ...) that the frontend widget
injects at prompt-build time, without declaring them up front.
"""

from typing import Union


class AnyType(str):
    """A type that compares equal to everything, so ComfyUI's type check passes."""

    def __ne__(self, _other) -> bool:
        return False


any_type = AnyType("*")


class FlexibleOptionalInputType(dict):
    """Accept any input key the frontend injects, plus optional seeded inputs.

    `__contains__` always returns True so ComfyUI accepts unknown keys;
    `__getitem__` returns the flexible type tuple for them. Entries passed via
    `data` behave like normal optional inputs (rendered as real sockets).
    """

    def __init__(self, type, data: Union[dict, None] = None):
        self.type = type
        self.data = data
        if self.data is not None:
            for k, v in self.data.items():
                self[k] = v

    def __getitem__(self, key):
        if self.data is not None and key in self.data:
            return self.data[key]
        return (self.type,)

    def __contains__(self, key):
        return True
