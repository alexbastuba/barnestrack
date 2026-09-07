/**
 * Colour-map anchor points, generated from matplotlib 3.9.1
 * (`matplotlib.colormaps[name]`) sampled at 33 evenly spaced positions and
 * rounded to 8 bits. Both maps are smooth enough that linear interpolation
 * between these anchors reproduces the full 256-entry table to within 3 levels
 * per channel for viridis and 5 for cividis — invisible on screen and in print
 * — while 33 triples stay readable in a diff.
 *
 * viridis and cividis are the two maps D32 names. Both are perceptually uniform
 * and monotone in lightness, which is what lets a figure using them survive a
 * grayscale printer; `luminanceMonotone` in `colormaps.ts` checks that rather
 * than taking it on trust.
 */

/** An 8-bit RGB triple. */
export type Rgb = readonly [number, number, number];

export const VIRIDIS_ANCHORS: readonly Rgb[] = [
  [68, 1, 84],
  [71, 13, 96],
  [72, 24, 106],
  [72, 35, 116],
  [71, 45, 123],
  [69, 55, 129],
  [66, 64, 134],
  [62, 73, 137],
  [59, 82, 139],
  [55, 91, 141],
  [51, 99, 141],
  [47, 107, 142],
  [44, 114, 142],
  [41, 122, 142],
  [38, 130, 142],
  [35, 137, 142],
  [33, 145, 140],
  [31, 152, 139],
  [31, 160, 136],
  [34, 167, 133],
  [40, 174, 128],
  [50, 182, 122],
  [63, 188, 115],
  [78, 195, 107],
  [94, 201, 98],
  [112, 207, 87],
  [132, 212, 75],
  [152, 216, 62],
  [173, 220, 48],
  [194, 223, 35],
  [216, 226, 25],
  [236, 229, 27],
  [253, 231, 37],
];

export const CIVIDIS_ANCHORS: readonly Rgb[] = [
  [0, 34, 78],
  [0, 40, 91],
  [0, 46, 106],
  [5, 51, 113],
  [26, 56, 111],
  [39, 62, 110],
  [50, 67, 109],
  [59, 73, 108],
  [67, 78, 108],
  [75, 84, 108],
  [83, 90, 109],
  [90, 95, 110],
  [97, 101, 111],
  [104, 106, 113],
  [111, 112, 115],
  [118, 118, 118],
  [125, 124, 120],
  [132, 130, 121],
  [140, 136, 120],
  [147, 142, 120],
  [155, 148, 118],
  [163, 154, 116],
  [171, 160, 114],
  [180, 167, 111],
  [188, 174, 108],
  [196, 180, 104],
  [205, 187, 99],
  [213, 194, 94],
  [222, 201, 88],
  [231, 209, 80],
  [240, 216, 70],
  [249, 224, 58],
  [254, 232, 56],
];
