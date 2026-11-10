// The Wikidata coverage survey: a dozen digital humanities projects and a dozen films and TV
// episodes, each as the parser would describe the citation. `expected` is the Wikidata item that is
// the right answer (checked against the recorded label, description, date and director on 2026-11-10), or null when Wikidata has no item for it.
const project = (name, query, expected) => ({ name, group: 'project', expected, query: { type: 'webpage', ...query } });
const film = (name, title, year, author, expected) => ({ name, group: 'film', expected, query: { type: 'motion_picture', title, year, author } });
const episode = (name, title, container, year, expected) => ({ name, group: 'tv', expected, query: { type: 'broadcast', title, container, year } });
export const SURVEY = [
  project('Digital Dante (owner\'s citation)', { title: 'The Divine Comedy', container: 'Digital Dante', author: 'Alighieri', year: 2014, yearEnd: 2020, url: 'https://digitaldante.columbia.edu/dante/divine-comedy/' }, null),
  project('Perseus Digital Library', { title: 'Perseus Digital Library', author: 'Crane', url: 'http://www.perseus.tufts.edu/hopper/' }, 'Q639661'),
  project('Valley of the Shadow', { title: 'The Valley of the Shadow: Two Communities in the American Civil War', author: 'Ayers', url: 'https://valley.lib.virginia.edu/' }, 'Q75853526'),
  project('Mapping the Republic of Letters', { title: 'Mapping the Republic of Letters', url: 'http://republicofletters.stanford.edu/' }, 'Q62991231'),
  project('Walt Whitman Archive', { title: 'The Walt Whitman Archive', author: 'Folsom', url: 'https://whitmanarchive.org/' }, 'Q140734745'),
  project('Rossetti Archive', { title: 'The Rossetti Archive', author: 'McGann', url: 'http://www.rossettiarchive.org/' }, 'Q138790083'),
  project('Orlando', { title: 'Orlando: Women\'s Writing in the British Isles from the Beginnings to the Present', author: 'Brown', url: 'https://orlando.cambridge.org/' }, 'Q60672320'),
  project('Slave Voyages', { title: 'Voyages: The Trans-Atlantic Slave Trade Database', url: 'https://www.slavevoyages.org/' }, 'Q7011981'),
  project('Old Bailey Online', { title: 'The Proceedings of the Old Bailey, 1674–1913', author: 'Hitchcock', url: 'https://www.oldbaileyonline.org/' }, null),
  project('Text Encoding Initiative', { title: 'Text Encoding Initiative', url: 'https://tei-c.org/' }, 'Q780920'),
  project('Internet Archive', { title: 'Internet Archive', url: 'https://archive.org/' }, 'Q461'),
  project('HathiTrust', { title: 'HathiTrust Digital Library', url: 'https://www.hathitrust.org/' }, 'Q3128305'),
  film('The Shawshank Redemption', 'The Shawshank Redemption', 1994, 'Darabont', 'Q172241'),
  film('Citizen Kane', 'Citizen Kane', 1941, 'Welles', 'Q24815'),
  film('Parasite', 'Parasite', 2019, 'Bong', 'Q61448040'),
  film('Moonlight', 'Moonlight', 2016, 'Jenkins', 'Q21527875'),
  film('Spirited Away', 'Spirited Away', 2001, 'Miyazaki', 'Q155653'),
  film('La dolce vita', 'La dolce vita', 1960, 'Fellini', 'Q18407'),
  film('Do the Right Thing', 'Do the Right Thing', 1989, 'Lee', 'Q1141252'),
  film('Get Out', 'Get Out', 2017, 'Peele', 'Q25136235'),
  episode('Breaking Bad "Ozymandias"', 'Ozymandias', 'Breaking Bad', 2013, 'Q15015260'),
  episode('Game of Thrones "The Rains of Castamere"', 'The Rains of Castamere', 'Game of Thrones', 2013, 'Q13416849'),
  episode('The Sopranos "Pine Barrens"', 'Pine Barrens', 'The Sopranos', 2001, 'Q3503872'),
  episode('Lost "The Constant"', 'The Constant', 'Lost', 2008, 'Q1050310'),
];
