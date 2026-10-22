// settle-baseline.mjs — the Composer as it was at e3909e1 (before settling and cluster presence), as sha256 hashes of
// its output on fixed cases, for assert-harmony.mjs and assert-compose.mjs: `settlePasses: 0` (with `presence: 'exact'`
// in Compose, and the phase-3 root given to harmonize) must reproduce every one byte for byte, once the fields added
// since are taken out (`normSpec`, `normHarmony`). The hashes were made by these same cases run on e3909e1's
// Composer/core; they hold for one Node (V8) build — regenerate them there if a Node upgrade moves a float.
import { createHash } from 'node:crypto';
import { buildRow } from '../core/row.js';
import { buildCells } from '../core/cells.js';
import { defaultRoot } from '../core/frame.js';
import { downbeats } from '../core/lines.js';

export const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
/** a spec without what came after e3909e1: the settle stats, the presence and settlePasses decisions and overrides */
export function normSpec(spec) {
  const s = JSON.parse(JSON.stringify(spec));
  delete s.input.overrides.settlePasses; delete s.input.overrides.presence;
  if (s.stats) delete s.stats.settle;
  if (s.decisions) s.decisions = s.decisions.filter((d) => d.what !== 'settlePasses' && d.what !== 'presence');
  return s;
}
/** a harmonization without what came after e3909e1: `settle` and `passes.rounds` */
export function normHarmony(h) {
  const x = JSON.parse(JSON.stringify(h));
  delete x.settle; if (x.passes) delete x.passes.rounds;
  return x;
}

export const COMPOSE_CASES = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 6], [[119, 42, 15, 8], 8], [[768, 769], 8], [[97, 103, 37], 5], [[19, 17, 16, 15], 3], [[768, 784], 8], [[41, 42, 43], 8], [[2048, 2049], 8], [[4099, 4093, 4091, 4079], 16]];
/** every compose case: [name, () => the spec at settlePasses 0 under the phase-3 root rule] */
export function composeCases(compose) {
  const extra = { presence: 'exact', settlePasses: 0 }, out = [];
  for (const [L, T] of COMPOSE_CASES) for (const seed of [1, 7]) out.push([`compose ${L.join(':')} ${T}s seed ${seed}`, () => compose(L, T, { seed, overrides: { ...extra } })]);
  for (const [L, T] of [[[768, 769], 8], [[41, 42, 43], 8]]) out.push([`compose full ${L.join(':')}`, () => compose(L, T, { worker: true, overrides: { ...extra } })]);
  out.push(['compose 768:769 8x8 even mod off', () => compose([768, 769], 8, { overrides: { ...extra, bars: 8, slotsPerBar: 8, anchors: 'even', modulation: false } })]);
  return out;
}
/** every harmonize case: [name, () => the harmonization at settlePasses 0, on the phase-3 root and its downbeat] */
export function harmonyCases(harmonize) {
  const out = [];
  for (const L of [[8, 7, 6, 5], [119, 42, 15, 8], [768, 784], [768, 769], [2048, 2049], [97, 103, 37]]) for (const [bars, S] of [[2, 8], [4, 8], [8, 8], [3, 5]]) for (const anchors of ['even', 'partitioned']) for (const modulation of [true, false]) {
    out.push([`harmonize ${L.join(':')} ${bars}x${S} ${anchors} ${modulation}`, () => {
      const row = buildRow(L), root = defaultRoot(row, 15, { presence: 'exact' });
      const cells = buildCells(row, { bars, slotsPerBar: S, anchors, phase: downbeats(row, bars * S, 1, root, { anchors })[0] });
      return harmonize(row, cells, { root, modulation, table: 'lean', settlePasses: 0 });
    }]);
  }
  return out;
}

export const COMPOSE_HASHES = {
  "compose 8:7:6:5 4s seed 1": '7501ca205c9359f7d73e05e411890d1770d6af29517dcafd1ae6455bbe6426b9',
  "compose 8:7:6:5 4s seed 7": '407007fa8b29379e62f3b3fc4c83e53398995f075325cd2a3639ebd022ab0b75',
  "compose 11:9:7:5 6s seed 1": 'bcd79e390eb70b8745a8e3e09b83f4b483503dbc309f8006df00adbc787a0d66',
  "compose 11:9:7:5 6s seed 7": '627a60dfe5e59f9971b50edbfc7423c52fe2af3da410c1723cf19025f10d4e9e',
  "compose 119:42:15:8 8s seed 1": 'd5812acc8c6adb5990c15f8d6989840bac20532441e9d0595ee851b96e952090',
  "compose 119:42:15:8 8s seed 7": '0483deeee039c570a88bd7b2d2f023f992d3319240124b4cfb632627c58b4592',
  "compose 768:769 8s seed 1": '53a6152a1091349d5b145dc66cf7c4235bdbba52a5c150fe6fc5252e12951c6f',
  "compose 768:769 8s seed 7": 'aa613f3ef559582e39bdf7387eba5e149993aaf754c9b51129e0b153699313e3',
  "compose 97:103:37 5s seed 1": '2e38f833d4e9bb833ad9d5a5244a0283b77c975cb7e65fcf56ae7e366866d632',
  "compose 97:103:37 5s seed 7": '6e3e91cddc2b717abe9cbb27d38a747f119850208c7dc80e7475be6fca492ea2',
  "compose 19:17:16:15 3s seed 1": 'd1644da2f9fbef41c9331c6d13323ac81ae0b64fa009edb59e76c9379e28f0f1',
  "compose 19:17:16:15 3s seed 7": '04c930d540adb3daf59ceaed0f506d5281b24bc5d1fce95733b91d4d815616bc',
  "compose 768:784 8s seed 1": 'b83794c85f704461d5324e439b87df09c9c47daa35a1f223dc9c3c25edc1d1d7',
  "compose 768:784 8s seed 7": '0b1305b87aaf199aa1efb599248553ce827794e6b5a6e3d96ba057a081adfb69',
  "compose 41:42:43 8s seed 1": '49961c56ec8cd2d3d1dba94d9625a055c627395d71a653eeca4bfa05b9b9dfb8',
  "compose 41:42:43 8s seed 7": 'd3cc931775aad2cb582a722d6f5b6a61a77e67b2c569e31a44534554fe80cd33',
  "compose 2048:2049 8s seed 1": '096e3b4bdaf43b9873ad24926926db9ddd3fb39c6dc67ef1381b4cbf32c23f7e',
  "compose 2048:2049 8s seed 7": 'b9a3a54e0f61cada2791dbad23f3ee3538ad5b60a7175ee5327484e00ff29dde',
  "compose 4099:4093:4091:4079 16s seed 1": '21541973b2c5b102c6c7019c2b8891435a07523141421b56f086943fdc8d8fce',
  "compose 4099:4093:4091:4079 16s seed 7": '83178250d213026e1e63791c8e8c813efb7584054eb379c8f8650e66b524cec9',
  "compose full 768:769": '3b7a0a52fd23b30a1fbd04a0792216efbdee58e6e7efe8bb52863451261bab25',
  "compose full 41:42:43": '04b71141f9c37a4101ce8c32aa67ddf718697adf08934d63b590109151cafa4c',
  "compose 768:769 8x8 even mod off": 'b184adeb829e75a42695984f46f8b7c750c1ec17b68e17ebe7944b5ede9a1f38',
};

export const HARMONY_HASHES = {
  "harmonize 8:7:6:5 2x8 even true": '04d544fe9c10873f30904da3476434d3e83b29a9d9186f20eb7248f257e920f8',
  "harmonize 8:7:6:5 2x8 even false": 'aa2f87ecc66919b975be870be1737383774d306a84b515079fa0de6bfba09121',
  "harmonize 8:7:6:5 2x8 partitioned true": '1f6a9246a3f921986a3b2d6b1d69816889080f4615726450283be12467211da0',
  "harmonize 8:7:6:5 2x8 partitioned false": 'd73fae240978c80680c56d7cc236df9a9a207b87f6bee2426ad7ca59ff3afae9',
  "harmonize 8:7:6:5 4x8 even true": '119fb3a6648ece065368de26fad7641a8e58a39a3275df387a400a2d3d85b91d',
  "harmonize 8:7:6:5 4x8 even false": 'be8d84565f23a58593bd06f835a27786b687c50d748c0b1963beb2e05fc79235',
  "harmonize 8:7:6:5 4x8 partitioned true": 'd86387e8ad8f61ee8d580fb9b19f3c7353107b21e17223180ad6ccdbc826e197',
  "harmonize 8:7:6:5 4x8 partitioned false": 'dbe1c2fc06ad3693bf457cf3034c12f932ffa764378da9fab68298cf3461fdf3',
  "harmonize 8:7:6:5 8x8 even true": 'a5906f6742da05d3e00dbac886ec5756bbe30184fbf7a51f694122daab397161',
  "harmonize 8:7:6:5 8x8 even false": '1ea6224b76a09dd2516e1bcec68d2d4f1d6f9db0d35e9de5abc70576596b48c5',
  "harmonize 8:7:6:5 8x8 partitioned true": '414df3a97e928f953c610bf5258438e40a84226eae7d7fea90e08e5da1bd4e1f',
  "harmonize 8:7:6:5 8x8 partitioned false": '8a15bc550a2d2a84be8641c65d7c3aabef28de77318b875141d1a4d9be2a208c',
  "harmonize 8:7:6:5 3x5 even true": '94982a383b227b319527174136caac311d2ff25ca100a8cdad9a41e6d90529ef',
  "harmonize 8:7:6:5 3x5 even false": '2c6eb472b2709d0c37c9b9708e6e50c9145f7dbe9c0c5e04db9e2323e8bed1ec',
  "harmonize 8:7:6:5 3x5 partitioned true": '458738e92987a0c349201229b5f019239651fc7b3f1eaf68d8cfff5e90a37876',
  "harmonize 8:7:6:5 3x5 partitioned false": '565082fda76f35bddb75a883db034943ffcb4dc756f5f6e7c55f5c48229ad2a8',
  "harmonize 119:42:15:8 2x8 even true": '82c4d95c701b1fecfa07b88c8886504c4c18ea34dfd13cfe94b6d10a8bd9f550',
  "harmonize 119:42:15:8 2x8 even false": 'ca8d2d07964fd175e43daf23d9ed95208a2b5c7563e764912d5c13b4a34c19e1',
  "harmonize 119:42:15:8 2x8 partitioned true": 'fe983e60a87ae6ca2d555b5039e2134c40b83e37a4153f6d75b0fda08bbb9a76',
  "harmonize 119:42:15:8 2x8 partitioned false": 'b7580a150a3076259cd95e764e0375ac96afcb097420b685d897e3e8c3ba1ca2',
  "harmonize 119:42:15:8 4x8 even true": 'ed180df7d70c7b283feba54f232993ea118631a8f06e1e27854f4ce786cc13db',
  "harmonize 119:42:15:8 4x8 even false": '958d98ebaccf7d6dbf60b552f21853d6de2394ef7abc4db17c7d2526c4302e42',
  "harmonize 119:42:15:8 4x8 partitioned true": '021269116bf073ce8aadef7784835568ba9af4df6d0e5f0759b8ca6da4065ead',
  "harmonize 119:42:15:8 4x8 partitioned false": 'e09fea236c21b66b244f6c19f33d1c88280b150e145b3f63fc2c3b7ce56fd777',
  "harmonize 119:42:15:8 8x8 even true": 'f9d72eb68e2f7675d4ca220aeed78f230d90bc46126c3e740320ae3105ad4f58',
  "harmonize 119:42:15:8 8x8 even false": 'f0ad2cf5792732792d5ae55610fedf8717080c7b89b6f23510332f9b4d9eda44',
  "harmonize 119:42:15:8 8x8 partitioned true": '86dd109513032071fe2f81fe36d6058ea18a97e4ea029e7fd9dbefa72dce8017',
  "harmonize 119:42:15:8 8x8 partitioned false": 'edf8908224ec861577cd309f2ae187521a46ee823e2b39151552e2ee0d067358',
  "harmonize 119:42:15:8 3x5 even true": 'ddcd49c8f4d19a17d99a1326d5d336349710f83c2b95b983eea5a486b058bf56',
  "harmonize 119:42:15:8 3x5 even false": '982636d586a6ad4913fbd563c0524f798aa13502c89cdae6d693d1972df6b5a3',
  "harmonize 119:42:15:8 3x5 partitioned true": '2fbe9cb53252b5db825425d01e6881d2097a034cfc933ba396bda69a08b6d70c',
  "harmonize 119:42:15:8 3x5 partitioned false": 'f1d4356af4f3f61cd5fd551cf0dd7e86c6fc3f5b475ee0ec176d24e4f0b3ccdc',
  "harmonize 768:784 2x8 even true": '2d643f6f0e871be596d896a7b8580357a78e3df14f6d79c8b515d2597a648405',
  "harmonize 768:784 2x8 even false": '64e35564d8f1c433d942fdfff7d2864d8ee52ddc6ced1ce6e0a5e3132f998f87',
  "harmonize 768:784 2x8 partitioned true": 'a61658e221679dcf5c94d58460c0a69665ea95eb7f91907cb56652a5f27f04f2',
  "harmonize 768:784 2x8 partitioned false": '649eaaae303402d5b95282e73920e2adb4a4e99fa282f50af29cf06452859f13',
  "harmonize 768:784 4x8 even true": '303817aa633237dfa269912e9a45583e4f5d923e7266f4026255a5a07050291b',
  "harmonize 768:784 4x8 even false": '7da2898957b2f2f9dda02df8797efa507f45d4204c15ba22c98c953799096cca',
  "harmonize 768:784 4x8 partitioned true": 'c98437862f24b78b55ffe53f2738bde2fd0dd454c160fbe397c16c584b744266',
  "harmonize 768:784 4x8 partitioned false": '57429dc50dcc0348d1ec67d386b73e30d48b79c11360f464c5087af4a4fd1e2c',
  "harmonize 768:784 8x8 even true": '8d42b5f9e44169cb30f891ada3f1f83add54b81ccf037151543c79f5da7136e7',
  "harmonize 768:784 8x8 even false": '5e1766a997b4c891906e4c156731216aea0aaf15062db42ea5ab615bcb81d576',
  "harmonize 768:784 8x8 partitioned true": '0aba8c27ef97e45c991e8617b475f7fc03750661ee0f907ba008c2ffd061b93b',
  "harmonize 768:784 8x8 partitioned false": '5462f6643601ce3a7ade3cb798760bfc4c84b0218cd05612b5274a7352e776f9',
  "harmonize 768:784 3x5 even true": '83d30a302714f8da3968d336ef0a991771e6cac6e836b95c41ea02aff4a90bad',
  "harmonize 768:784 3x5 even false": '4611f2bae77df4310e98b994d4baeba8f7e25711b53faa37b1101d4a2da21e27',
  "harmonize 768:784 3x5 partitioned true": 'cb47bbac931b92995351eca40d69bd1bfb59e16d25c3a9f13a2e465453004f9f',
  "harmonize 768:784 3x5 partitioned false": '5947b346ac8b3e92b89d1eae869e5415a7dec45a31012144a83abfc35a5b849b',
  "harmonize 768:769 2x8 even true": '09a20fbe9fc0e48136cf489c647ecc28359bc01cc0946696365386a0361727ae',
  "harmonize 768:769 2x8 even false": '6612b1b24d4b02073471cd65838c663de2221aaa19a09a6e06554a80aa72f1b1',
  "harmonize 768:769 2x8 partitioned true": '0cad16960d750730fef56b7b990a2ecdc3cc0441f417c0d70555bed39b185ad5',
  "harmonize 768:769 2x8 partitioned false": '836218f102f57e3bddb221b0f70ec1e5b5e170eb8112361cfe931dca4d556dbb',
  "harmonize 768:769 4x8 even true": '1d770450a2671bc7d5ce995f9440d1bba70d6f36b79093d8f7bd0eea7c3ab327',
  "harmonize 768:769 4x8 even false": '20d23831e86f17898d5ef94640024dbc433b5967fd98e18c2848f2e55c8ce2ce',
  "harmonize 768:769 4x8 partitioned true": 'c75b196dabad4daf9b30387153bae4c6ba01a3f84472bdc06530b0d4ba2107fd',
  "harmonize 768:769 4x8 partitioned false": '6c265ff4edfde252db4957818654eaff7221b5a0094732e1d6a831d185499237',
  "harmonize 768:769 8x8 even true": '16538e02111297181f1c1057c5103c87c647876046a39bb6ea5121eca031b95e',
  "harmonize 768:769 8x8 even false": '15634ea0dd31bc4fd69c1e06b165984655c3e3b6ed05a979626cb4347178e334',
  "harmonize 768:769 8x8 partitioned true": '9cc67c4a51e56c90ec93993fa5403f73e6c59f2e6dbd99e15b7d2c9d8270842e',
  "harmonize 768:769 8x8 partitioned false": 'a7cca20ef28506ca45b5eaab8dbb4dcf067cc62e506df407c535b202bc371fcc',
  "harmonize 768:769 3x5 even true": 'da70c4f2f182987195d72c8109c27ef4da1456e6716f734e3c3296b5e2beef7a',
  "harmonize 768:769 3x5 even false": '1c246421a4063ce8f5bda1f08ed113fcf6a915880923d83ba5d05658dadd08e2',
  "harmonize 768:769 3x5 partitioned true": 'a5a19c672f13ef5523c33815423e2be33f53706aa5179a42697ba033980dfea9',
  "harmonize 768:769 3x5 partitioned false": '25f0267e317a64a0e76719ef5e84256c38d8d7a3215794a5128cc24f97328a21',
  "harmonize 2048:2049 2x8 even true": 'b79c870eeed205201e50dbb37a0bca4c149241b6b516921bae767793d58da0a3',
  "harmonize 2048:2049 2x8 even false": '1b682124afca341a8571527b21290cedad67df481200b2b5aec3d29c67eeb41d',
  "harmonize 2048:2049 2x8 partitioned true": 'd70b7a77edbf42e185323f57b5785ced25b8950a5e301b5c7078843f0e32ce9c',
  "harmonize 2048:2049 2x8 partitioned false": '03b6b0104951508f1d5629e8e98f8c6f0c20a40ac695ffebd89cdbfad5c135c1',
  "harmonize 2048:2049 4x8 even true": 'dea67c393113c01a3cd344343a2392df84d076840895c4959bd1385c11254abe',
  "harmonize 2048:2049 4x8 even false": 'aaabd2a8639d5066367ccee2661e6f08f3fedcb2b186667dd4bfa5d315b6604f',
  "harmonize 2048:2049 4x8 partitioned true": '21cb6ea8436497ea0b5b79080953cc38699e48a08183f666d9215a908c28c252',
  "harmonize 2048:2049 4x8 partitioned false": 'db31f2cbeca65ef316097a4e9b4a8e38ddffee14d3e36f9505c8c37e8730c6e4',
  "harmonize 2048:2049 8x8 even true": 'd9ecc73b1fae0aba72cceaef41e68be418dc2b3e5a23e8c9513df230017d5cf1',
  "harmonize 2048:2049 8x8 even false": '88b135966eb6e92039564ed09bc2e7b49fb8c0c4d4a84addb93cf736226302d9',
  "harmonize 2048:2049 8x8 partitioned true": 'dfac0b3be8d2723557a22895cdb4304f9a4aa4336d9f679f27d78f28e40c783d',
  "harmonize 2048:2049 8x8 partitioned false": '1870241adbb8de0607877878d2f36c57487d3553161ee5f6321cde24d2606e31',
  "harmonize 2048:2049 3x5 even true": '430516b63f510e4fc3c361f8bf390985e8a6b6393eb6aa3301ea8024514d96b7',
  "harmonize 2048:2049 3x5 even false": '0e9d74323c4d28278e2a0193be4301cd0e92f4bab25d527785b31a91723ecaba',
  "harmonize 2048:2049 3x5 partitioned true": '9e930f9683856d57dda9d9770d1a6a1cb6608c778ef8afb0f0f9a30b5a444c5f',
  "harmonize 2048:2049 3x5 partitioned false": '5811b44c77b0a3a33ae1ef207b22525781d05af88c4b32b6bc23cd8ec2f93e61',
  "harmonize 97:103:37 2x8 even true": '262f5c8f58273c47ba64f523b87bd7fbc7ca28c498a8ce993f0c68584e421a50',
  "harmonize 97:103:37 2x8 even false": '53fa7123ad4d623706f30b6b069e546c898d4fd7231302c75d94f3efb57c3419',
  "harmonize 97:103:37 2x8 partitioned true": 'b777d38668f9502e1ff400e047e18a9655afdf5c67e1e93d39e3592dfd49f801',
  "harmonize 97:103:37 2x8 partitioned false": '3005573eb28d4683203e81e1450f4147111cd06def1e598195a3f014f11aa434',
  "harmonize 97:103:37 4x8 even true": '552215410c317c6aba4a0bedd4a38da8c76ede89c4d7332c87754a4bdaa87c33',
  "harmonize 97:103:37 4x8 even false": '20d4bf8bf7622f6d7500c8efaa5dda6ab57a928008871dfc6487f5bf2ba82e5f',
  "harmonize 97:103:37 4x8 partitioned true": '390001928c6284eb20bcd10963d93a050c033335d876b10f34f64ea5ffe6eeee',
  "harmonize 97:103:37 4x8 partitioned false": 'fe55411428d97640203a15b38bd0073b194cac4fa07156eee3ed5c82db92ec71',
  "harmonize 97:103:37 8x8 even true": '17090c860b21aae229bcb2af1acfac58619e9b46f68eaa6826b93fe7436c063e',
  "harmonize 97:103:37 8x8 even false": 'cf3b2de806dad933092637ac5be47333a0eb875c35a31cfce615356533f29de7',
  "harmonize 97:103:37 8x8 partitioned true": 'ca1309c665a808e1c5f2a63af4f6667545ad83255c5ff475fa845f6572863b3c',
  "harmonize 97:103:37 8x8 partitioned false": 'a762b60f342cd9f05d9fe08d673eb8243155e95209d440311e924aa340263100',
  "harmonize 97:103:37 3x5 even true": 'f68a073ef400052f7545efd27170347441185e9feddeb5b357e16cf19cf1dc10',
  "harmonize 97:103:37 3x5 even false": '9f270f32291b48863b037f3dc61cf5f3d951e63b706bd10071e15cbecdc2ef79',
  "harmonize 97:103:37 3x5 partitioned true": 'd29ca1585739a281f88cf323355acdbd2baa88e878176575fe0ce8c22c804848',
  "harmonize 97:103:37 3x5 partitioned false": 'a16b1b95cbc4c42c52c9ddd6105111a13a65ef6942015c24dddabf6ca6ff8643',
};
