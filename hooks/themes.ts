// Nickname themes: the pools the names module draws from, and what the plugin's `nicknameTheme` and `sounds` options
// mean. Pure data and two readers, so the tests and the names module use them without an engine. Every pool is plain
// ASCII and short enough for a sidebar row, and no name appears in two themes.

export const THEME_IDS = ['people', 'planets', 'japanese-snacks', 'pirates', 'space-crew', 'forest-friends', 'robots'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export const DEFAULT_THEME: ThemeId = 'people'

export type NameTheme = {
  id: ThemeId
  /** What the options menu calls it. */
  title: string
  /** Names for members, taken in turn. */
  members: readonly string[]
  /** Names for the lead. */
  leads: readonly string[]
}

// Ordinary first names, for people who want their agents named like colleagues: members and, for the lead, other names.
const PEOPLE_MEMBERS: readonly string[] = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Jamie', 'Morgan', 'Avery', 'Quinn',
  'Emma', 'Liam', 'Olivia', 'Noah', 'Sophia', 'Lucas', 'Mia', 'Ethan', 'Chloe', 'Daniel',
  'Grace', 'Henry', 'Isabel', 'Jack', 'Laura', 'Leo', 'Lily', 'Mark', 'Nina', 'Oscar',
  'Paul', 'Rachel', 'Ryan', 'Sarah', 'Simon', 'Tom', 'Anna', 'Ben', 'Clara', 'David',
  'Elena', 'Felix', 'Hannah', 'Ian', 'Julia', 'Kevin', 'Lena', 'Martin', 'Nora', 'Peter',
  'Rosa', 'Sean', 'Tara', 'Victor', 'Zoe', 'Adam', 'Beth', 'Carlos', 'Diana', 'Eric',
  'Fiona', 'George', 'Helen', 'Ivan', 'Jenny', 'Kate', 'Luke', 'Maya', 'Nathan', 'Owen',
  'Priya', 'Raj', 'Sofia', 'Tim', 'Uma', 'Vera', 'Will', 'Yuki', 'Amir', 'Lina',
]

const PEOPLE_LEADS: readonly string[] = [
  'Margaret', 'Robert', 'Catherine', 'Michael', 'Elizabeth', 'Richard', 'Patricia', 'Thomas', 'Susan', 'Andrew',
  'Rebecca', 'Jonathan',
]

// Futuristic worlds for members (catalog-style and evocative) and stars for the lead, so name, planet and card read as one world.
const PLANETS_MEMBERS: readonly string[] = [
  'Kepler-7b', 'Vega Prime', 'Nyx', 'Orion Drift', 'Zephyr-9', 'Lumen', 'Astra Nova', 'Tycho', 'Calyx-4', 'Solenne',
  'Io Halo', 'Rhea-3', 'Cygni Echo', 'Halcyon', 'Pyxis', 'Nebulon', 'Xerra', 'Thalassa-5', 'Aurelia', 'Kestrel-2',
  'Vanta', 'Selene-9', 'Draxis', 'Elara-6', 'Corvus Reach', 'Mira Vale', 'Oberon Deep', 'Talos-12', 'Ceres Bloom', 'Zenara',
  'Lyonesse', 'Proxima-b', 'Hydrus', 'Equinox', 'Novaterra', 'Arcadia-3', 'Sable', 'Ventara', 'Kairos', 'Umbra-5',
  'Aether', 'Tethys Gate', 'Vireo-8', 'Celestia', 'Orrery', 'Gliese-12c', 'Zircon', 'Polar Ember', 'Andara', 'Quillon',
  'Rhodium', 'Cassio-4', 'Ixion', 'Meridian', 'Sylphe', 'Trappist-3', 'Valis', 'Echo Prime', 'Halo-7', 'Nadir',
  'Ostara', 'Peryton', 'Rune-6', 'Seraphis', 'Taurex', 'Ulyra', 'Vesper', 'Wolf-359d', 'Xenon Reach', 'Yonder',
  'Zaphra', 'Borealis', 'Corona-9', 'Dione Mist', 'Eos Drift', 'Fenrir-2', 'Gaia Nova', 'Hyperion', 'Ilios', 'Juno Tide',
]

const PLANETS_LEADS: readonly string[] = [
  'Polaris Major', 'Sirius Prime', 'Altair', 'Vega Core', 'Rigel', 'Lyra Nova', 'Deneb', 'Antares',
  'Capella', 'Arcturus', 'Canopus', 'Aldebaran',
]

const JAPANESE_SNACKS_MEMBERS: readonly string[] = [

  'Mochi-chan', 'Onigiri-kun', 'Tamago', 'Kuma-san', 'Daifuku', 'Taiyaki', 'Matcha Pop', 'Wasabi', 'Yuki Bento', 'Hoshi',
  'Sakura Puff', 'Ramen Sensei', 'Neko Ninja', 'Tanuki', 'Udon', 'Kombu', 'Dango', 'Kitsune', 'Panko', 'Momo',
  'Takoyaki', 'Edamame', 'Nori-chan', 'Miso', 'Yuzu', 'Tofu Ninja', 'Mikan', 'Azuki', 'Kinako', 'Shiba-kun',
  'Pocky Pal', 'Karaage', 'Okonomi', 'Mame-chan', 'Hanabi', 'Tsubaki', 'Kaeru-kun', 'Usagi', 'Tori-chan', 'Fugu Puff',
  'Koi-chan', 'Kappa-kun', 'Daruma', 'Maneki', 'Ume', 'Suika', 'Ringo', 'Hojicha', 'Genmai', 'Soba',
  'Somen', 'Tempura', 'Mimi', 'Poyo', 'Fuwa Fuwa', 'Pon-chan', 'Nyan', 'Wan-chan', 'Kiki', 'Cocoa',
  'Waffle', 'Pickles', 'Biscuit', 'Captain Noodle', 'Sprinkles', 'Pudding', 'Pretzel', 'Muffin', 'Marshmallow', 'Nugget',
  'Pancake', 'Beans', 'Gumdrop', 'Cupcake', 'Mango', 'Peanut', 'Churro', 'Bao Bun', 'Dumpling', 'Sesame',
]

const JAPANESE_SNACKS_LEADS: readonly string[] = [

  'Captain Ramen', 'Shogun Sushi', 'Admiral Mochi', 'Boss Tanuki', 'General Gyoza', 'Commander Miso',
  'Sensei Panda', 'Shogun Waffle', 'Captain Onigiri', 'Prof Pudding', 'Admiral Udon', 'Boss Daifuku',
]

const PIRATES_MEMBERS: readonly string[] = [
  'Peg Leg Pete', 'Barnacle', 'Salty Sam', 'Jolly Roger', 'Parrot Pal', 'Rum Runner', 'Doubloon', 'Cutlass', 'Scurvy Sue', 'Mutiny Mike',
  'Bosun Bob', 'Crow Nest', 'Plank Walker', 'Anchor Annie', 'Kraken Kid', 'Gold Tooth', 'Eye Patch', 'Hook Hand', 'Bilge Rat', 'Cannonball',
  'Sea Dog', 'Dread Ned', 'Mango Mary', 'Cabin Boy', 'Treasure Tom', 'Black Beard', 'Red Sails', 'Mermaid Mo', 'Shiver Tim', 'Crackerjack',
  'Squid Pro', 'Rigging Rae', 'Hornpipe', 'Compass Cal', 'Spyglass', 'Davy Jones', 'Gull Girl', 'Tidal Tess', 'Port Side', 'Starboard',
  'Jib Jab', 'Lagoon Lou', 'Storm Sid', 'Tattoo Tara', 'Grog Gus', 'Boatswain', 'Wharf Rat', 'Sandbar Sal', 'Cove Carl', 'Dinghy Dan',
  'Galleon', 'Pieces of Eight', 'Skull Cap', 'Bandana Bea', 'Swabbie', 'Poop Deck', 'Ahoy Al', 'Yo Ho Hank', 'Marooned Max', 'Buoy Boy',
  'Brine Brian', 'Coral Cora', 'Fathom Fay', 'Harpoon Hal', 'Isle Izzy', 'Keelhaul Ken', 'Lookout Lil', 'Mainsail', 'Nautical Nan', 'Oar Olly',
  'Pearl Pat', 'Quartermaster', 'Rowdy Rex', 'Seaweed Sue', 'Tackle Tom', 'Urchin Ugo', 'Voyage Vic', 'Wave Walker', 'Yardarm', 'Zig Zag Zeke',
]

const PIRATES_LEADS: readonly string[] = [
  'Captain Cutlass', 'Admiral Barnacle', 'Commodore Crab', 'Captain Squid', 'Queen Anne', 'Admiral Anchor', 'Captain Calico', 'Lord Kraken',
  'Captain Gold', 'Commodore Plank', 'Admiral Rum', 'Captain Jolly',
]

const SPACE_CREW_MEMBERS: readonly string[] = [
  'Comet', 'Nova Nelly', 'Pulsar', 'Orbit', 'Quasar Quin', 'Astro Ace', 'Moon Pie', 'Rocket Rae', 'Meteor', 'Cosmo',
  'Stardust', 'Lunar Lou', 'Nebula', 'Galaxy Gus', 'Photon', 'Zero G Zed', 'Eclipse', 'Asteroid Al', 'Starlight', 'Apollo Jr',
  'Gemini', 'Sputnik', 'Lander Lee', 'Rover Rex', 'Capsule', 'Booster', 'Thruster', 'Solar Sam', 'Mars Mike', 'Venus Vee',
  'Jupiter Jo', 'Saturn Sid', 'Neptune Ned', 'Pluto Pup', 'Mercury', 'Titan', 'Europa', 'Io Io', 'Callisto', 'Ganymede',
  'Andromeda', 'Orion', 'Vega', 'Sirius', 'Polaris', 'Lyra', 'Draco', 'Cassie Peia', 'Hubble', 'Voyager',
  'Cassini', 'Kepler', 'Galileo', 'Luna', 'Sol', 'Aurora', 'Supernova', 'Wormhole', 'Warp Wendy', 'Blast Off Bo',
  'Cadet Cleo', 'Ensign Eli', 'Pilot Pip', 'Navigator', 'Radar Ray', 'Gravity Gail', 'Helmet Hal', 'Visor Vic', 'Airlock', 'Satellite',
  'Probe', 'Beacon', 'Cosmic Cat', 'Moon Boot', 'Star Sprout', 'Quark', 'Ion Ivy', 'Flare', 'Zenith', 'Zodiac',
]

const SPACE_CREW_LEADS: readonly string[] = [
  'Captain Comet', 'Admiral Nebula', 'Commander Nova', 'Captain Quasar', 'Commodore Orbit', 'Admiral Stardust', 'Captain Pulsar', 'Commander Luna',
  'Captain Meteor', 'Admiral Galaxy', 'Commander Vega', 'Captain Zenith',
]

const FOREST_FRIENDS_MEMBERS: readonly string[] = [
  'Acorn', 'Mossy', 'Fern', 'Hedgehog Hal', 'Badger Bea', 'Owl Otis', 'Fox Finn', 'Bramble', 'Maple', 'Pinecone',
  'Mushroom Mo', 'Willow', 'Thistle', 'Fiddlehead', 'Squirrel Sid', 'Otter Ozzy', 'Beaver Bo', 'Moose Moe', 'Fawn Fia', 'Bunny Bee',
  'Toadstool', 'Clover', 'Dewdrop', 'Birch', 'Hazel', 'Juniper', 'Lichen', 'Meadow', 'Nutmeg', 'Poppy',
  'Quill', 'Rowan', 'Sorrel', 'Tansy', 'Violet', 'Wren', 'Yarrow', 'Ivy', 'Cedar', 'Aspen',
  'Chipmunk Chip', 'Raccoon Ray', 'Deer Dot', 'Bear Bruno', 'Wolf Wyn', 'Lynx Lu', 'Hare Harry', 'Mole Milo', 'Vole Vera', 'Newt Nell',
  'Frog Fred', 'Snail Sal', 'Moth Mia', 'Firefly', 'Cricket', 'Ladybug', 'Bumble', 'Sparrow', 'Robin Rue', 'Finch Fay',
  'Heron Hugo', 'Duck Dale', 'Turtle Tim', 'Possum Pat', 'Skunk Sky', 'Boar Bill', 'Stag Stu', 'Doe Dana', 'Marmot', 'Pika Pip',
  'Burrow', 'Hollow', 'Glade', 'Brook', 'Pebble', 'Twig', 'Sprout', 'Sapling', 'Canopy', 'Moss Pup',
]

const FOREST_FRIENDS_LEADS: readonly string[] = [
  'Elder Oak', 'Warden Willow', 'Queen Maple', 'Old Man Moss', 'Chief Cedar', 'Grandma Birch', 'Elder Elm', 'Warden Wren',
  'King Pinecone', 'Lady Fern', 'Chief Hedgehog', 'Elder Owl',
]

const ROBOTS_MEMBERS: readonly string[] = [
  'Bolt', 'Sparky', 'Beep', 'Boop', 'Widget', 'Gizmo', 'Servo', 'Cogsworth', 'Byte', 'Pixel',
  'Circuit', 'Gadget', 'Rusty', 'Chip', 'Clank', 'Whirr', 'Sprocket', 'Tin Tim', 'Binary Bo', 'Kernel',
  'Vector', 'Nano', 'Micro', 'Droid Dan', 'Unit Seven', 'Megabyte', 'Gigabyte', 'Cache', 'Daemon', 'Fuse',
  'Gear Gus', 'Hertz', 'Ohm', 'Volt', 'Amp', 'Watt', 'Joule', 'Relay', 'Diode', 'Resistor',
  'Capacitor', 'Transistor', 'Solder', 'Wire Wes', 'Bot Bo', 'Mecha Mo', 'Cyber Cy', 'Turbo', 'Zap', 'Zip',
  'Bleep', 'Blip', 'Buzz', 'Click', 'Clack', 'Ping', 'Pong', 'Tick Tock', 'Whiz', 'Flux',
  'Gyro', 'Hydra', 'Logic Lee', 'Motor Max', 'Piston Pete', 'Quark Bot', 'Router', 'Socket', 'Tuner', 'Valve Val',
  'Wrench', 'Axle', 'Bearing', 'Cog', 'Dynamo', 'Engine Ed', 'Flywheel', 'Gasket', 'Hinge', 'Lever Lou',
]

const ROBOTS_LEADS: readonly string[] = [
  'Overlord Bolt', 'Major Mainframe', 'Chief Circuit', 'Admiral Algo', 'Boss Bot', 'Captain Cog', 'Commander Core', 'Prime Unit',
  'General Gear', 'Director Dynamo', 'Chief Chip', 'Colonel Cable',
]

export const THEMES: Record<ThemeId, NameTheme> = {
  people: { id: 'people', title: 'People', members: PEOPLE_MEMBERS, leads: PEOPLE_LEADS },
  planets: { id: 'planets', title: 'Planets and stars', members: PLANETS_MEMBERS, leads: PLANETS_LEADS },
  'japanese-snacks': { id: 'japanese-snacks', title: 'Japanese snacks', members: JAPANESE_SNACKS_MEMBERS, leads: JAPANESE_SNACKS_LEADS },
  pirates: { id: 'pirates', title: 'Pirates', members: PIRATES_MEMBERS, leads: PIRATES_LEADS },
  'space-crew': { id: 'space-crew', title: 'Space crew', members: SPACE_CREW_MEMBERS, leads: SPACE_CREW_LEADS },
  'forest-friends': { id: 'forest-friends', title: 'Forest friends', members: FOREST_FRIENDS_MEMBERS, leads: FOREST_FRIENDS_LEADS },
  robots: { id: 'robots', title: 'Robots', members: ROBOTS_MEMBERS, leads: ROBOTS_LEADS },
}

/** The theme an option value names; a missing, mistyped or unknown value is the default. */
export function themeOf(option: unknown): NameTheme {
  return typeof option === 'string' && (THEME_IDS as readonly string[]).includes(option) ? THEMES[option as ThemeId] : THEMES[DEFAULT_THEME]
}

/** Sounds are on unless the option says off (false, "off" or "false"). */
export function soundsOn(option: unknown): boolean {
  return !(option === false || option === 'off' || option === 'false')
}
