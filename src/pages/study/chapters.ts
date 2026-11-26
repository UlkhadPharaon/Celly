/**
 * Chapter content for the text-only surface.
 *
 * The facts are not re-written here: they come from the same `organelles.json` and
 * `knowledge.json` the 3D lab uses, so a reader of the textbook is examined on exactly the same
 * material as someone who manipulated the model. What is authored here is only the connective
 * tissue — the order, the framing and the figures described in words.
 */

import type { KnowledgeNode, Loc, LocList, OrganelleMeta } from '../../types';
import { ORGANELLES, KNOWLEDGE_NODES } from '../../data/catalog';

export interface TextbookFigure {
  caption: Loc;
  /** A description of what a picture would have shown, written so it carries information. */
  description: Loc;
}

export interface TextbookEntry {
  id: string;
  name: Loc;
  /** One-sentence definition. */
  definition: Loc;
  /** Structure notes. */
  structure: Loc;
  /** What it does, in order. */
  functions: LocList;
  /** Worth remembering. */
  fact: Loc;
}

export interface TextbookChapter {
  id: string;
  number: number;
  title: Loc;
  /** Optional framing paragraph shown before the first entry. */
  intro?: Loc;
  entries: TextbookEntry[];
  figure?: TextbookFigure;
  /** Cross-references to knowledge-map nodes, named in the closing paragraph. */
  relatedNodes?: string[];
}

const byId = new Map(ORGANELLES.map((o) => [o.id, o]));

function entry(id: string): TextbookEntry {
  const organelle = byId.get(id) as OrganelleMeta;
  return {
    id: organelle.id,
    name: organelle.name,
    definition: organelle.shortDescription,
    structure: organelle.structure,
    functions: organelle.function,
    fact: organelle.funFact
  };
}

function chapter(
  number: number,
  id: string,
  title: Loc,
  intro: Loc | undefined,
  entryIds: string[],
  figure?: TextbookFigure,
  relatedNodes?: string[]
): TextbookChapter {
  return { id, number, title, intro, entries: entryIds.map(entry), figure, relatedNodes };
}

const CELL_TYPES: KnowledgeNode[] = KNOWLEDGE_NODES.filter((node) => node.category === 'Cell types');

/** The reading material, in order. */
export const CHAPTERS: TextbookChapter[] = [
  chapter(
    1,
    'what-is-a-cell',
    { en: 'The cell in one page', fr: 'La cellule en une page' },
    {
      en: 'Everything alive is made of cells, and every cell is a self-contained chemical factory: it takes in material, turns it into energy and structure, copies its instructions, and divides. The cell described here is a eukaryotic animal cell — the kind that keeps its DNA inside a nucleus and splits its work between compartments. Those compartments are the organelles, and each one exists because a job has to be done in a controlled place.',
      fr: 'Tout ce qui est vivant est fait de cellules, et chaque cellule est une usine chimique autonome : elle absorbe de la matière, la transforme en énergie et en structure, copie ses instructions et se divise. La cellule décrite ici est une cellule animale eucaryote — le type qui garde son ADN dans un noyau et répartit son travail entre compartiments. Ces compartiments sont les organites, et chacun existe parce qu’une tâche doit être faite dans un endroit contrôlé.'
    },
    ['membrane', 'cytoplasm'],
    {
      caption: { en: 'Figure 1 — A whole cell, cut open', fr: 'Figure 1 — Une cellule entière, ouverte' },
      description: {
        en: 'Picture a soft sphere about the width of a hair. Its outer skin is the membrane, thin as soap film. Most of the interior is cytoplasm: a clear, crowded jelly in which everything else floats. Near the centre sits a large round nucleus, wrapped in its own double envelope with pores. Around it, folded sheets of rough endoplasmic reticulum; stacked, flattened sacs of the Golgi apparatus; bean-shaped mitochondria scattered between them; small dense vesicles and occasional vacuoles; and a mesh of fine filaments holding the whole shape. Nothing is static: the sheets pulse, the vesicles bud off and travel, the filaments grow and dissolve.',
        fr: 'Imaginez une sphère molle de la largeur d’un cheveu. Sa peau externe est la membrane, fine comme une pellicule de savon. L’essentiel de l’intérieur est le cytoplasme : une gelée claire et encombrée dans laquelle flotte tout le reste. Près du centre se trouve un grand noyau rond, enveloppé de sa double membrane percée de pores. Autour, des feuillets repliés de réticulum endoplasmique rugueux ; les sacs aplatis et empilés de l’appareil de Golgi ; des mitochondries en forme de haricot dispersées ; de petites vésicules denses et quelques vacuoles ; enfin un maillage de filaments fins qui tient la forme de l’ensemble. Rien n’est figé : les feuillets pulsent, les vésicules bourgeonnent et se déplacent, les filaments croissent et se dissolvent.'
      }
    }
  ),
  chapter(
    2,
    'the-boundary',
    { en: 'The boundary and the interior', fr: 'La frontière et l’intérieur' },
    {
      en: 'A cell lives or dies by what it lets through its membrane. The boundary is not a wall but a selective filter, and it is the cytoplasm — not the organelles — that does the mixing, moving and buffering that keeps everything else able to work.',
      fr: 'Une cellule vit ou meurt selon ce que sa membrane laisse passer. La frontière n’est pas un mur mais un filtre sélectif, et c’est le cytoplasme — non les organites — qui assure le mélange, le déplacement et la mise en mémoire tampon qui permettent au reste de fonctionner.'
    },
    ['membrane', 'cytoplasm']
  ),
  chapter(
    3,
    'the-nucleus',
    { en: 'The nucleus: instructions and control', fr: 'Le noyau : instructions et contrôle' },
    {
      en: 'The nucleus holds the DNA, and holding the DNA means holding the instructions for every protein the cell can build. Nothing leaves the nucleus in raw form: instructions are copied into temporary messages, checked, then exported through pores in the envelope. Inside the nucleus itself, the nucleolus is a workshop rather than a container — it builds the parts of the ribosomes that will read those messages.',
      fr: 'Le noyau contient l’ADN, et détenir l’ADN signifie détenir les instructions de chaque protéine que la cellule peut fabriquer. Rien ne sort du noyau sous forme brute : les instructions sont copiées en messages temporaires, vérifiées, puis exportées par les pores de l’enveloppe. À l’intérieur même du noyau, le nucléole est un atelier plutôt qu’un contenant — il fabrique les pièces des ribosomes qui liront ces messages.'
    },
    ['nucleus', 'nuclear-envelope', 'nucleolus'],
    {
      caption: { en: 'Figure 2 — The nucleus and its envelope', fr: 'Figure 2 — Le noyau et son enveloppe' },
      description: {
        en: 'Draw the nucleus as two concentric circles: the inner one is a dense tangle of chromatin, the outer one a membrane broken by round pores like the holes of a colander. RNA copies squeeze through those pores. In the middle of the tangle, a darker, rounder region without a membrane of its own: the nucleolus, assembling ribosome parts that will be shipped out and finished in the cytoplasm.',
        fr: 'Dessinez le noyau comme deux cercles concentriques : le cercle intérieur est un enchevêtrement dense de chromatine, le cercle extérieur une membrane percée de pores ronds comme les trous d’une passoire. Les copies d’ARN se faufilent par ces pores. Au milieu de l’enchevêtrement, une région plus sombre et plus ronde, sans membrane propre : le nucléole, qui assemble les pièces des ribosomes, ensuite expédiées et achevées dans le cytoplasme.'
      }
    },
    ['protein-synthesis']
  ),
  chapter(
    4,
    'energy',
    { en: 'Energy', fr: 'L’énergie' },
    {
      en: 'A cell does not run on fuel, it runs on ATP, and ATP is made here. Mitochondria are also the only organelles with their own DNA, which is one of the strongest clues that they were once independent bacteria that a distant ancestor swallowed instead of digesting.',
      fr: 'Une cellule ne fonctionne pas avec du carburant mais avec de l’ATP, et l’ATP est produit ici. Les mitochondries sont aussi les seuls organites dotés de leur propre ADN, l’un des indices les plus forts qu’elles furent jadis des bactéries indépendantes qu’un ancêtre lointain avala au lieu de les digérer.'
    },
    ['mitochondrion']
  ),
  chapter(
    5,
    'the-protein-factory',
    { en: 'The protein factory', fr: 'L’usine à protéines' },
    {
      en: 'Proteins are the working parts of a cell, and building one is an assembly line: ribosomes read the message, the endoplasmic reticulum folds and finishes, the Golgi sorts, labels and ships. Each hand-off is a physical bud of membrane that pinches off and merges again.',
      fr: 'Les protéines sont les pièces travaillantes d’une cellule, et en fabriquer une est une chaîne de montage : les ribosomes lisent le message, le réticulum endoplasmique replie et achève, l’appareil de Golgi trie, étiquète et expédie. Chaque transmission est un bourgeon de membrane qui se pince et se referme ailleurs.'
    },
    ['ribosome', 'rough-er', 'smooth-er', 'golgi'],
    {
      caption: { en: 'Figure 3 — The assembly line', fr: 'Figure 3 — La chaîne de montage' },
      description: {
        en: 'Follow one protein. It is born as a ribosome, a small dark grain pressed against the rough ER — the sheet whose outer face is studded with those same grains. It slides through a pore in the sheet and folds inside the lumen, helped by chaperones. It leaves in a vesicle. The vesicle fuses with the first sac of the Golgi stack, a pile of flattened pouches; inside, the protein is trimmed, tagged with a sugar marker, and packed into a second vesicle that leaves the stack toward the membrane. On the way it opens and releases its cargo outside, or into a lysosome.',
        fr: 'Suivez une protéine. Elle naît d’un ribosome, petit grain sombre pressé contre le réticulum rugueux — le feuillet dont la face externe est couverte de ces mêmes grains. Elle glisse par un pore du feuillet et se replie dans la lumière, aidée par des chaperons. Elle sort dans une vésicule. La vésicule fusionne avec le premier sac de l’empilement de Golgi, une pile de poches aplaties ; à l’intérieur, la protéine est taillée, marquée d’un sucre, puis empaquetée dans une seconde vésicule qui quitte la pile vers la membrane. En route, elle s’ouvre et libère sa cargaison à l’extérieur, ou dans un lysosome.'
      }
    },
    ['protein-synthesis']
  ),
  chapter(
    6,
    'recycling-and-storage',
    { en: 'Recycling, storage and defence', fr: 'Recyclage, stockage et défense' },
    {
      en: 'Everything the factory builds has to end somewhere. Lysosomes take the worn-out parts apart, vacuoles store and hold water, peroxisomes deal with the reactive chemistry that would otherwise damage the cell. The cell survives by clearing its own waste as fast as it makes it.',
      fr: 'Tout ce que l’usine construit doit finir quelque part. Les lysosomes démontent les pièces usées, les vacuoles stockent et retiennent l’eau, les peroxysomes traitent la chimie réactive qui endommagerait autrement la cellule. La cellule survit en éliminant ses propres déchets aussi vite qu’elle les produit.'
    },
    ['lysosome', 'vacuole', 'peroxisome']
  ),
  chapter(
    7,
    'shape-and-movement',
    { en: 'Shape and movement', fr: 'Forme et mouvement' },
    {
      en: 'A cell is not a water balloon. Its shape, its ability to move and its ability to divide all rest on the cytoskeleton, three different filament systems that build, pull and cut. The centrioles organise the ropes that separate the copies of the genome when the cell divides.',
      fr: 'Une cellule n’est pas un ballon d’eau. Sa forme, sa capacité à se déplacer et à se diviser reposent sur le cytosquelette : trois systèmes de filaments qui construisent, tirent et coupent. Les centrioles organisent les cordages qui séparent les copies du génome lors de la division.'
    },
    ['cytoskeleton', 'centriole'],
    {
      caption: { en: 'Figure 4 — Three systems of filaments', fr: 'Figure 4 — Trois systèmes de filaments' },
      description: {
        en: 'Three patterns fill the cytoplasm. Thick ropes, each built from bundled strands, that resist being squeezed. Thin, stiff tracks that motors walk along carrying vesicles. And the finest mesh, a net that reinforces the membrane from just inside and changes shape as the cell moves. Two short rods sit at right angles to each other near the nucleus; from them, the mitotic spindle is assembled when the cell divides.',
        fr: 'Trois motifs remplissent le cytoplasme. Des cordages épais, chacun fait de faisceaux de brins, qui résistent à la compression. Des rails fins et rigides, sur lesquels des moteurs marchent en portant des vésicules. Et le filet le plus fin, qui renforce la membrane depuis l’intérieur et change de forme quand la cellule se déplace. Deux bâtonnets courts se tiennent à angle droit près du noyau ; c’est d’eux que le fuseau mitotique est assemblé lors de la division.'
      }
    }
  ),
  chapter(
    8,
    'cells-differ',
    { en: 'The same parts, different lives', fr: 'Les mêmes pièces, des vies différentes' },
    {
      en: 'Every human cell carries the same instruction book, yet no two cell types work alike, because each one reads a different chapter of it. What changes between a nerve and a muscle cell is not the parts list but the size, the number and the shape of those parts.',
      fr: 'Chaque cellule humaine porte le même livre d’instructions, et pourtant aucun type cellulaire ne travaille comme un autre, parce que chacun en lit un chapitre différent. Ce qui change entre un neurone et une cellule musculaire n’est pas la liste des pièces, mais la taille, le nombre et la forme de ces pièces.'
    },
    [],
    undefined,
    CELL_TYPES.map((node) => node.id)
  )
];

/** A short glossary of the fifteen organelles, used at the end of the reading material. */
export const GLOSSARY: Array<{ term: Loc; definition: Loc }> = ORGANELLES.map((o) => ({
  term: o.name,
  definition: o.shortDescription
}));

/** Estimated reading time of the whole material, in minutes, at a slow reading pace. */
export function readingMinutes(): number {
  const words = CHAPTERS.reduce((total, chapter) => {
    const chapterWords = chapter.entries.reduce((sum, entry) => {
      const text = [
        entry.name.en,
        entry.definition.en,
        entry.structure.en,
        entry.fact.en,
        ...entry.functions.en
      ].join(' ');
      return sum + text.split(/\s+/).length;
    }, 0);
    return total + chapterWords + (chapter.intro?.en.split(/\s+/).length ?? 0);
  }, 0);
  return Math.max(6, Math.round(words / 130));
}