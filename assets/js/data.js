/* =========================================================================
   Bigpot Publication — Book Catalogue Data
   Each book points to its image folder. Page images are listed explicitly
   (some folders contain irregular filenames like "4(1).jpg").
   Paths are encoded at render time, so raw paths with spaces are fine here.
   ========================================================================= */

const CATALOGUE = [
  /* ---------------------- RPF EXAM PREPARATION ---------------------- */
  {
    id: "five-in-one",
    category: "rpf",
    title: "Indian Railway Law",
    subtitle: "भारतीय रेलवे कानून की पुस्तक",
    tagline: "5-in-1 Combined Acts",
    edition: "Edition 2026",
    description:
      "Railways Act 1989, RPF Rules 1987, Railway Property (Unlawful Possession) Act 1966, RPF (Amendment) Act 2003, Official Language Act & Standing Orders — five essential acts in one volume.",
    folder: "RPF BOOKS/5 IN 1",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg"]
  },
  {
    id: "bns",
    category: "rpf",
    title: "Bharatiya Nyaya Sanhita 2023",
    subtitle: "भारतीय न्याय संहिता एवं साक्ष्य अधिनियम",
    tagline: "BNS + Sakshya Adhiniyam",
    edition: "Edition 2023",
    description:
      "Concise notes on the Bharatiya Nyaya Sanhita, 2023 and the Bharatiya Sakshya Adhiniyam, 2023 — an essential study companion for the Railway Protection Force.",
    folder: "RPF BOOKS/BNS",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "4(1).jpg", "5.jpg", "6.jpg", "7.jpg"]
  },
  {
    id: "bnss",
    category: "rpf",
    title: "Bharatiya Nagarik Suraksha Sanhita 2023",
    subtitle: "भारतीय नागरिक सुरक्षा संहिता 2023",
    tagline: "BNSS — Procedure Code",
    edition: "Edition 2023",
    description:
      "Collected study material on the Bharatiya Nagarik Suraksha Sanhita, 2023 with concise notes prepared for RPF aspirants.",
    folder: "RPF BOOKS/BNSS",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg"]
  },
  {
    id: "crime-manual",
    category: "rpf",
    title: "Hindi Crime Manual",
    subtitle: "अपराध नियमावली का प्रारूप",
    tagline: "RPF Crime Manual",
    edition: "Latest Edition",
    description:
      "The Railway Protection Force crime manual in Hindi — investigation procedures, formats and the framework of railway crime regulation.",
    folder: "RPF BOOKS/Crime Manual",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg"]
  },
  {
    id: "crime-disaster",
    category: "rpf",
    title: "Crime on Railways & Disaster Management",
    subtitle: "रेलवे में अपराध एवं आपदा प्रबन्धन",
    tagline: "Sub-Inspector Syllabus",
    edition: "Edition 2026",
    description:
      "Railway crime, cyber crime, psychology, railway systems and disaster management — compiled as per the Sub-Inspector syllabus of the Railway Protection Force.",
    folder: "RPF BOOKS/Crime on Railways and Disaster",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg", "7.jpg"]
  },
  {
    id: "hindi-qns",
    category: "rpf",
    title: "Objective & Descriptive Questions",
    subtitle: "वस्तुनिष्ठ और वर्णनात्मक प्रश्नों का संग्रह",
    tagline: "RPF ASI Selection u/r 72",
    edition: "Revised • July 2025",
    description:
      "A curated bank of objective and descriptive questions with answers from previous examinations — prepared for the RPF ASI selection under rule 72.",
    folder: "RPF BOOKS/HINDI QNS",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"]
  },
  {
    id: "minor-acts",
    category: "rpf",
    title: "Minor Acts & Security Circulars",
    subtitle: "लघु अधिनियम / सुरक्षा परिपत्र",
    tagline: "Railway Service (Conduct) Rules 1966",
    edition: "Edition 2026",
    description:
      "Minor acts, security circulars and the Railway Services (Conduct) Rules, 1966 — compiled as per the Sub-Inspector syllabus of the Railway Protection Force.",
    folder: "RPF BOOKS/MINOR ACTS & SECURITY CIRCULAR",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg"]
  },

  /* ---------------------- RAILWAY ENGINEERING ---------------------- */
  {
    id: "cw-eng",
    category: "engineering",
    title: "Carriage & Wagon Handbook",
    subtitle: "Supervisor Training Manual — English",
    tagline: "Stream Specific Theory",
    edition: "Second Edition 2024",
    description:
      "A supervisor training handbook covering Carriage & Wagon stream-specific theory — bogies, suspension, brake systems and maintenance fundamentals.",
    folder: "RAILWAY ENGINEERING BOOKS/C & W ENG",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"]
  },
  {
    id: "cw-hindi",
    category: "engineering",
    title: "कैरेज और वैगन हैंडबुक",
    subtitle: "Carriage & Wagon Handbook — Hindi",
    tagline: "प्रशिक्षण नोट्स • Stream Specific Theory",
    edition: "Latest Edition",
    description:
      "The Carriage & Wagon supervisor training handbook in Hindi — stream-specific theory and training notes for railway engineering staff.",
    folder: "RAILWAY ENGINEERING BOOKS/C & W HINDI",
    pages: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg", "7.jpg"]
  }
];

/* Convenience helpers used by the renderer */
const CATEGORY_LABELS = {
  rpf: "RPF Preparation",
  engineering: "Railway Engineering"
};

/* Build a browser-safe URL for a given book page */
function pageURL(book, file) {
  return encodeURI(book.folder + "/" + file);
}
function coverURL(book) {
  return pageURL(book, book.pages[0]);
}
