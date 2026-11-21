# 0003-supplied-hlsl-source-of-truth.md

# Supplied HLSL is the glass source of truth

The repository currently contains no HLSL files and no `LiquidGlassRefraction.hlsl`; the pasted crop/Dual-Kawase shader is therefore treated as a specification excerpt, not as the complete implementation. The complete Liquid Glass and Candy Glass HLSL files will be supplied by the user and will be the source of truth for the native glass pipeline. The migration must not silently substitute a CSS-derived approximation or a different shader implementation.
