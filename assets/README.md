# Noteleaf brand assets

`noteleaf-logo.png` is the transparent high-resolution master artwork. `icon.png`, `icon-mac.png`, and `icon.ico` are aspect-ratio-preserving generated derivatives used by the application and installers. Run `npm run icons` on Windows after replacing the master.

The artwork was generated specifically for this project with OpenAI's image-generation tool on 2026-08-28 and is included as part of the Apache-2.0-licensed Noteleaf Work. The attached design references guided the page-and-leaf concept; the delivered pixels are newly generated artwork.

Original 1.0 generation prompt:

> Create an original production app icon for a desktop notes application named Noteleaf, inspired by the supplied references without copying them exactly. Show one clean white note page with a folded upper-right corner that flows organically into a single elegant green leaf. Place it inside a softly rounded-square mint-green app tile. Use a fresh emerald-to-mint gradient, gentle depth, subtle ambient shadow, clean modern geometry, and a calm premium productivity-app aesthetic. Keep the silhouette legible at 16–32 px. No letters, no words, no watermark, no extra objects. Center the mark with generous padding. Deliver a square PNG with a genuine transparent background outside the rounded tile.

Transparency refinement prompt:

> Preserve the icon design exactly. Remove every checkerboard/background pixel outside the rounded-square tile and replace it with genuine alpha transparency. Keep the rounded tile, white page, green leaf, gradients, highlights, shadows, and all internal details unchanged. Return a clean square PNG with RGBA transparency and no text.

Version 1.0.1 contrast redesign prompt:

> Redesign the Noteleaf icon for much stronger small-size visibility while preserving the recognizable concept of a note page flowing into one leaf. Replace the washed-out pale mint tile with a solid deep emerald rounded-square tile. Make the page warm light gray/off-white rather than pure white, with a bold clean dark-green edge where needed. Make the leaf a brighter saturated mint/green shape distinct from both page and tile. Enlarge and simplify the central silhouette so it remains recognizable at 16, 24, and 32 pixels. Use minimal vector-like shapes, only 5–7% transparent padding, no letters, no text, no watermark, no checkerboard, no thin lines, no pale outer glow, and genuine alpha outside the rounded tile.

Version 1.0.1 transparency refinement prompt:

> Remove every checkerboard and pale background pixel outside the dark emerald rounded-square tile and replace that outside area with genuine alpha transparency. Preserve the dark emerald tile, warm off-white note page, saturated green leaf, shapes, colors, proportions, edges, and all internal details exactly. Change only the area outside the rounded-square tile. Use a clean antialiased edge with no white halo; output an RGBA PNG with actual transparency.
