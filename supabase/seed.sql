-- =========================================================================
--  Bigpot Publication — seed the catalogue (9 titles)
--  Run AFTER schema.sql. Re-runnable: upserts on the unique slug.
--  Image paths point at the folders shipped with the static site, so no
--  image migration is needed. New uploads from the admin panel go to Storage.
-- =========================================================================

insert into public.books
  (slug, category, title, subtitle, tagline, edition, description, cover_path, pages, sort_order)
values
  ('five-in-one', 'rpf',
   'Indian Railway Law', 'भारतीय रेलवे कानून की पुस्तक', '5-in-1 Combined Acts', 'Edition 2026',
   'Railways Act 1989, RPF Rules 1987, Railway Property (Unlawful Possession) Act 1966, RPF (Amendment) Act 2003, Official Language Act & Standing Orders — five essential acts in one volume.',
   'RPF BOOKS/5 IN 1/0.jpg',
   '["RPF BOOKS/5 IN 1/0.jpg","RPF BOOKS/5 IN 1/1.jpg","RPF BOOKS/5 IN 1/2.jpg","RPF BOOKS/5 IN 1/3.jpg","RPF BOOKS/5 IN 1/4.jpg"]'::jsonb,
   10),

  ('bns', 'rpf',
   'Bharatiya Nyaya Sanhita 2023', 'भारतीय न्याय संहिता एवं साक्ष्य अधिनियम', 'BNS + Sakshya Adhiniyam', 'Edition 2023',
   'Concise notes on the Bharatiya Nyaya Sanhita, 2023 and the Bharatiya Sakshya Adhiniyam, 2023 — an essential study companion for the Railway Protection Force.',
   'RPF BOOKS/BNS/0.jpg',
   '["RPF BOOKS/BNS/0.jpg","RPF BOOKS/BNS/1.jpg","RPF BOOKS/BNS/2.jpg","RPF BOOKS/BNS/3.jpg","RPF BOOKS/BNS/4.jpg","RPF BOOKS/BNS/4(1).jpg","RPF BOOKS/BNS/5.jpg","RPF BOOKS/BNS/6.jpg","RPF BOOKS/BNS/7.jpg"]'::jsonb,
   20),

  ('bnss', 'rpf',
   'Bharatiya Nagarik Suraksha Sanhita 2023', 'भारतीय नागरिक सुरक्षा संहिता 2023', 'BNSS — Procedure Code', 'Edition 2023',
   'Collected study material on the Bharatiya Nagarik Suraksha Sanhita, 2023 with concise notes prepared for RPF aspirants.',
   'RPF BOOKS/BNSS/0.jpg',
   '["RPF BOOKS/BNSS/0.jpg","RPF BOOKS/BNSS/1.jpg","RPF BOOKS/BNSS/2.jpg","RPF BOOKS/BNSS/3.jpg","RPF BOOKS/BNSS/4.jpg","RPF BOOKS/BNSS/5.jpg","RPF BOOKS/BNSS/6.jpg"]'::jsonb,
   30),

  ('crime-manual', 'rpf',
   'Hindi Crime Manual', 'अपराध नियमावली का प्रारूप', 'RPF Crime Manual', 'Latest Edition',
   'The Railway Protection Force crime manual in Hindi — investigation procedures, formats and the framework of railway crime regulation.',
   'RPF BOOKS/Crime Manual/0.jpg',
   '["RPF BOOKS/Crime Manual/0.jpg","RPF BOOKS/Crime Manual/1.jpg","RPF BOOKS/Crime Manual/2.jpg","RPF BOOKS/Crime Manual/3.jpg"]'::jsonb,
   40),

  ('crime-disaster', 'rpf',
   'Crime on Railways & Disaster Management', 'रेलवे में अपराध एवं आपदा प्रबन्धन', 'Sub-Inspector Syllabus', 'Edition 2026',
   'Railway crime, cyber crime, psychology, railway systems and disaster management — compiled as per the Sub-Inspector syllabus of the Railway Protection Force.',
   'RPF BOOKS/Crime on Railways and Disaster/0.jpg',
   '["RPF BOOKS/Crime on Railways and Disaster/0.jpg","RPF BOOKS/Crime on Railways and Disaster/1.jpg","RPF BOOKS/Crime on Railways and Disaster/2.jpg","RPF BOOKS/Crime on Railways and Disaster/3.jpg","RPF BOOKS/Crime on Railways and Disaster/4.jpg","RPF BOOKS/Crime on Railways and Disaster/5.jpg","RPF BOOKS/Crime on Railways and Disaster/6.jpg","RPF BOOKS/Crime on Railways and Disaster/7.jpg"]'::jsonb,
   50),

  ('hindi-qns', 'rpf',
   'Objective & Descriptive Questions', 'वस्तुनिष्ठ और वर्णनात्मक प्रश्नों का संग्रह', 'RPF ASI Selection u/r 72', 'Revised • July 2025',
   'A curated bank of objective and descriptive questions with answers from previous examinations — prepared for the RPF ASI selection under rule 72.',
   'RPF BOOKS/HINDI QNS/0.jpg',
   '["RPF BOOKS/HINDI QNS/0.jpg","RPF BOOKS/HINDI QNS/1.jpg","RPF BOOKS/HINDI QNS/2.jpg","RPF BOOKS/HINDI QNS/3.jpg","RPF BOOKS/HINDI QNS/4.jpg","RPF BOOKS/HINDI QNS/5.jpg"]'::jsonb,
   60),

  ('minor-acts', 'rpf',
   'Minor Acts & Security Circulars', 'लघु अधिनियम / सुरक्षा परिपत्र', 'Railway Service (Conduct) Rules 1966', 'Edition 2026',
   'Minor acts, security circulars and the Railway Services (Conduct) Rules, 1966 — compiled as per the Sub-Inspector syllabus of the Railway Protection Force.',
   'RPF BOOKS/MINOR ACTS & SECURITY CIRCULAR/0.jpg',
   '["RPF BOOKS/MINOR ACTS & SECURITY CIRCULAR/0.jpg","RPF BOOKS/MINOR ACTS & SECURITY CIRCULAR/1.jpg","RPF BOOKS/MINOR ACTS & SECURITY CIRCULAR/2.jpg","RPF BOOKS/MINOR ACTS & SECURITY CIRCULAR/3.jpg"]'::jsonb,
   70),

  ('cw-eng', 'engineering',
   'Carriage & Wagon Handbook', 'Supervisor Training Manual — English', 'Stream Specific Theory', 'Second Edition 2024',
   'A supervisor training handbook covering Carriage & Wagon stream-specific theory — bogies, suspension, brake systems and maintenance fundamentals.',
   'RAILWAY ENGINEERING BOOKS/C & W ENG/0.jpg',
   '["RAILWAY ENGINEERING BOOKS/C & W ENG/0.jpg","RAILWAY ENGINEERING BOOKS/C & W ENG/1.jpg","RAILWAY ENGINEERING BOOKS/C & W ENG/2.jpg","RAILWAY ENGINEERING BOOKS/C & W ENG/3.jpg","RAILWAY ENGINEERING BOOKS/C & W ENG/4.jpg","RAILWAY ENGINEERING BOOKS/C & W ENG/5.jpg"]'::jsonb,
   80),

  ('cw-hindi', 'engineering',
   'कैरेज और वैगन हैंडबुक', 'Carriage & Wagon Handbook — Hindi', 'प्रशिक्षण नोट्स • Stream Specific Theory', 'Latest Edition',
   'The Carriage & Wagon supervisor training handbook in Hindi — stream-specific theory and training notes for railway engineering staff.',
   'RAILWAY ENGINEERING BOOKS/C & W HINDI/0.jpg',
   '["RAILWAY ENGINEERING BOOKS/C & W HINDI/0.jpg","RAILWAY ENGINEERING BOOKS/C & W HINDI/1.jpg","RAILWAY ENGINEERING BOOKS/C & W HINDI/2.jpg","RAILWAY ENGINEERING BOOKS/C & W HINDI/3.jpg","RAILWAY ENGINEERING BOOKS/C & W HINDI/4.jpg","RAILWAY ENGINEERING BOOKS/C & W HINDI/5.jpg","RAILWAY ENGINEERING BOOKS/C & W HINDI/6.jpg","RAILWAY ENGINEERING BOOKS/C & W HINDI/7.jpg"]'::jsonb,
   90)

on conflict (slug) do update set
  category    = excluded.category,
  title       = excluded.title,
  subtitle    = excluded.subtitle,
  tagline     = excluded.tagline,
  edition     = excluded.edition,
  description = excluded.description,
  cover_path  = excluded.cover_path,
  pages       = excluded.pages,
  sort_order  = excluded.sort_order;
