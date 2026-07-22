/**
 * A shared identity spanning several ways that are physically one named
 * facility — two one-way carriageways of Decatur Avenue, the paired tracks
 * of a rail line, a trail crossing many junction-split segments. What the
 * identity is *called* in the UI comes from the way family's catalog noun
 * ("Street" / "Line" / "Trail"), never hardcoded.
 */
export interface NamedWay {
  id: string;
  name: string;
  wayIds: string[];
}

/** The median (or other separator) between two carriageways of one
 *  NamedWay — captured when separateCarriageways splits a two-way profile,
 *  so its width/kind survive a later combine instead of combineProfiles
 *  falling back to a generic default. Keyed by NamedWay id. */
export interface Median {
  widthM: number;
  kindId: string;
}
