PARTITIONS
Planning document for the Large Rhythm Collider’s forthcoming Partitions feature.

Glaring irony: it’s called the Large Rhythm Collider and it has no drums. Time to fix that.

I have resisted building sophisticated DAW-like features into the LRC, since midi and tuning file export allows for the user to transfer info to their own DAW with far superior capability compared to a web build. However, having everything at the fingertips right on the site is also attractive. This feature will add a drum accompaniment section which will serve as a test build for perhaps an actual VST in the future. 

One-to-one “this layer triggers a snare” would be boring. Partitions will use a polyrhythm-adjacent concept that deals with approximation. 

Part of the point of the LRC is the ability to explore ludicrous rhythmic structures far outside of what a human could be expected to perceive on a composite level. Performance of even a relatively low-layer-sum rhythm of 4 layers requires approximation. An example:

11:9:7:5. With a grid of 3465 and resulting fundamental of 315 (MS tag 11-315-1) this rhythm is too large to be played fast enough for the pulses to be reasonably perceived as such, if the player is actually feeling the underlying grid. Instead, you can approach this complicated rhythm by approximation. 

Take the outer two layers, 11:5. This is performable; probably feeling from the 11 side, with 11 beats of quintuplets. The 5 layer plays on every 11th beat, notching one space over in the modulo 5 grid for each appearance. On this underlying 55 grid, we’ll approximate 9 and 7 as best we can.

55 is not divisible by 9, but 9 x 6 = 54, just one beat less. We have a remainder of 1 to distribute. If one of those 6s becomes a 7, the sequence will match our 55 beat grid. A similar case for 7; 55 is not divisible by 7 but 7 x 8 = 56, which means if one of the 8s is a 7, we’ll also land on 55. 

Arranging our approximated layers inside the 55 grid, we now have a syncopated and very challenging pattern, but still feasible to learn with time because we did not have to further subdivide our already-granular 55 beat grid. The inner layers have a very slight unevenness, thanks to our minimal distribution of the remainder among the existing pulses, but this is almost imperceptible and likely to be smoothed out by imperfections in performance, especially given that the application of such a thing varies greatly depending on the musical context. As always, the LRC remains almost “pre”-musical or metamusical in the sense that it deals with a serialization concept that exists “prior” to actual composition. 

The distributed-remainder Partitions described above naturally apply outside of insular polyrhythm structure. See Max Roach’s genius 5-5-6 pattern on Bud Powell’s Un Poco Loco, a recording nearly 75 years old. This could be described as a 3 partition of 16, achieving minimal pulse invariance of 3 divisions of the 16th note grid. 

Within the Large Rhythm Collider, Partitions will allow for the user to dynamically set different beat divisions for drum accompaniment relative to both the Grid and individual Layer groupings. 
ALGORITHM
Let’s formalize the Partition process.

T is the time interval being Partitioned; main options will be described later (Grid, Sequence, Grouping).

Example: Grid 60

P represents the number of divisions to be applied. 

Example: P 7  of 60

For any interval T, there will be some multiple G of P which is closer in value to T than any other multiple.

G is the grouping size (duration on Grid) of the “base” pulse for this partition before the remainder distribution. 

7 x 9 = 63, G = 9

R is the absolute value |P*G - T|, the distance from the product of PG to T. 

63 - 60 = 3, R = 3

R defines a number of “base” pulses which must be either expanded or contracted by ± one. 

If PG > T, minus one. If PG < T, plus one.

63 > 60, contract R base pulses. T = 7G, R = 3, so now T = 4G + 3(G-1). 

T = 60,  G = 9,  check: 60 = 4*9 + 3*(8) -> 63 = 36 + 24, correct. 

This is the deterministic part. The more complex but still fairly approachable part will be the structure of the remainder distributions: which beats in the progression of P will have size G±1?

The example case, 4 nines and 3 eights, has a fairly simple logically even distribution: 9 8 9 8 9 8 9, with that extra 9 looping around the beginning. 

This is a known procedure for creating Euclidean rhythms, and the LRC will provide at least a Euclidean preset for distribution based on the Bjorklund algorithm and a Symmetry preset that appears when symmetry options are detected for remainder distribution. The latter could get a bit complicated, but the former should be deterministic. However, we’ll also include a UI feature that allows the player to click-and-drag colored blocks to manually restructure the Partition sequence as they like. 

LAYOUT
To keep consistency with the main architecture, we’ll have 4 Partitions layers connected to the 4 tone row layers. Each layer gets assigned a drum sample asset. Ideally, we’ll eventually mirror the same volume, ADSR and filter controls for each layer, but first priority is getting the partition logic working. *Note, we need to modularize the ToneRowPlayback.js monolith into separate scripts to make the ADSR and filter modules easier to access for this

Each layer has a numeric input to assign the number of Partitions. Then, we need options for the T interval to which we apply the Partition: Grid, Sequence and Grouping.

Grid: Apply the Partition to the entire Grid of the polyrhythm (simplest, default setting). 


Sequence: Sequence looks at the correspondent tone layer and its frequency value. We then Partition that sequence of notes with our drum accompaniment, such that the drum hits every few beats of a given layer. 

Example, a polyrhythm 19:17:16:15 with a Sequence Partition 4 on layer D means we partition the 15 hits in layer D by 4, yielding 3 *4 + 1 * 3. The drum layer’s G size is 4 so it generally hits every 4th note in layer D. 

Grouping: Here, we look at the correspondent tone layer for this Partition and find its Grouping size (calculated for Expanded Info View, given by grid / frequency layer value).

The Partition will be applied to the inner Grouping of each note of this layer. This allows for fast micro-time rhythms that are more sparsely accompanied by the actual tones. 

For example, if a layer has a grouping size of 48 between each of its tones and we apply a partition of 5 within that grouping size, we’ll get 3 * 10 + 2  * 9; the partition’s G size is 10 beats on the actual underlying Grid of the polyrhythm. 

The number of Partitions can never exceed the T value it is partitioning whether that is Grid, number of hits in a Sequence or the Grouping size. 

Once a Partition is defined, we create a section of colored blocks of number P. At maximum zoom we can probably fit 20 blocks in the horizontal section afforded to it in the Partitions window. We’ll use command+scroll within the block window to zoom in and out as needed, and horizontally scroll between various sections of the pattern as needed . 

This block distribution will default to a Euclidean distribution. In fact, we may not mess with a Symmetry finder, or maybe later, and save UI space that would be taken up by a distribution preset selector. Default Euclidean or the user can drag and drop blocks as desired. 

So a single layer Partitions section might look like this: 


A ]  [P slider]  [Mode select]  [Sample select] [Volume slider] [Settings]                                                                      
[ Blocks representing partitions, proportionally sized according to the actual ratio of G and G-1.


The “A” or other layer button will be clickable to turn the layer on or off. The P slider will dynamically set the maximum based on the Mode selected. The slider can also be double-clicked to input a value manually. Default to 1 with layer off.

Mode select defaults to Grid, other options are Sequence and Grouping. 

Sample selector houses our drum samples.

SETTINGS button switches individual Partitions layer panel display to reveal its ADSR knobs and individual filter. 
