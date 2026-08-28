# Noteleaf brand assets

`noteleaf-logo.png` is the transparent 1254×1254 master artwork. `icon.png`, `icon-mac.png`, and `icon.ico` are generated derivatives used by the application and installers. Run `npm run icons` on Windows after replacing the master.

The artwork was generated specifically for this project with OpenAI's image-generation tool on 2026-08-28 and is included as part of the Apache-2.0-licensed Noteleaf Work. The attached design references guided the page-and-leaf concept; the delivered pixels are newly generated artwork.

Generation prompt:

> Create an original production app icon for a desktop notes application named Noteleaf, inspired by the supplied references without copying them exactly. Show one clean white note page with a folded upper-right corner that flows organically into a single elegant green leaf. Place it inside a softly rounded-square mint-green app tile. Use a fresh emerald-to-mint gradient, gentle depth, subtle ambient shadow, clean modern geometry, and a calm premium productivity-app aesthetic. Keep the silhouette legible at 16–32 px. No letters, no words, no watermark, no extra objects. Center the mark with generous padding. Deliver a square PNG with a genuine transparent background outside the rounded tile.

Transparency refinement prompt:

> Preserve the icon design exactly. Remove every checkerboard/background pixel outside the rounded-square tile and replace it with genuine alpha transparency. Keep the rounded tile, white page, green leaf, gradients, highlights, shadows, and all internal details unchanged. Return a clean square PNG with RGBA transparency and no text.
