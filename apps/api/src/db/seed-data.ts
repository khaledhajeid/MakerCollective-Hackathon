/**
 * Mock catalog for development and the pitch demo. Categories are GENERIC placeholders:
 * the organisers have not confirmed the final award names, and every category/exhibitor
 * is fully editable from the admin console (no "3" is hard-coded anywhere).
 */
export interface SeedCategory {
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  color: string;
}

export interface SeedExhibitor {
  nameEn: string;
  nameAr: string;
  projectEn: string;
  projectAr: string;
  descriptionEn: string;
  descriptionAr: string;
  booth: string;
  categories: string[];
}

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    slug: 'most-innovative',
    nameEn: 'Most Innovative Project',
    nameAr: 'المشروع الأكثر ابتكاراً',
    descriptionEn: 'The idea that made you say “why didn’t anyone think of this before?”',
    descriptionAr: 'الفكرة التي جعلتك تقول: لماذا لم يفكر بها أحد من قبل؟',
    color: '#7f32d9',
  },
  {
    slug: 'community-choice',
    nameEn: 'Community Choice',
    nameAr: 'اختيار المجتمع',
    descriptionEn: 'The project with the biggest positive impact on people around us.',
    descriptionAr: 'المشروع صاحب الأثر الإيجابي الأكبر على الناس من حولنا.',
    color: '#4a68d8',
  },
  {
    slug: 'best-design',
    nameEn: 'Best Design & Craft',
    nameAr: 'أفضل تصميم وحِرفة',
    descriptionEn: 'Beautifully made — form, finish and attention to detail.',
    descriptionAr: 'صُنع بإتقان — الشكل واللمسات النهائية والاهتمام بالتفاصيل.',
    color: '#74dccf',
  },
];

export const SEED_EXHIBITORS: SeedExhibitor[] = [
  {
    nameEn: 'Solar Sprout',
    nameAr: 'نبتة شمسية',
    projectEn: 'Off-grid smart irrigation',
    projectAr: 'ري ذكي يعمل بالطاقة الشمسية',
    descriptionEn:
      'A solar-powered drip controller that reads soil moisture and saves up to 40% of water on family farms.',
    descriptionAr:
      'وحدة تحكم بالري بالتنقيط تعمل بالطاقة الشمسية تقيس رطوبة التربة وتوفّر حتى ٤٠٪ من المياه في المزارع العائلية.',
    booth: 'A1',
    categories: ['most-innovative', 'community-choice'],
  },
  {
    nameEn: 'Hands of Petra',
    nameAr: 'أيادي البتراء',
    projectEn: 'Laser-cut heritage lamps',
    projectAr: 'مصابيح تراثية بالقص الليزري',
    descriptionEn: 'Nabataean patterns reimagined as modular lamps, cut from reclaimed wood.',
    descriptionAr:
      'زخارف نبطية بتصميم معاصر على شكل مصابيح قابلة للتركيب، مقطوعة من خشب معاد تدويره.',
    booth: 'A2',
    categories: ['best-design'],
  },
  {
    nameEn: 'Braille Buddy',
    nameAr: 'رفيق برايل',
    projectEn: 'Low-cost Braille tutor',
    projectAr: 'معلّم برايل منخفض التكلفة',
    descriptionEn:
      'A 3D-printed device that teaches Arabic and English Braille with audio feedback.',
    descriptionAr: 'جهاز مطبوع ثلاثي الأبعاد يعلّم برايل العربية والإنجليزية مع إرشاد صوتي.',
    booth: 'A3',
    categories: ['community-choice', 'most-innovative'],
  },
  {
    nameEn: 'Amman Air',
    nameAr: 'هواء عمّان',
    projectEn: 'Neighbourhood air-quality mesh',
    projectAr: 'شبكة لقياس جودة الهواء في الأحياء',
    descriptionEn: 'Dozens of cheap sensors that map air quality street by street, in real time.',
    descriptionAr: 'عشرات الحساسات منخفضة التكلفة ترسم خريطة جودة الهواء شارعاً بشارع وبشكل لحظي.',
    booth: 'B1',
    categories: ['community-choice'],
  },
  {
    nameEn: 'Loom Lab',
    nameAr: 'مختبر النول',
    projectEn: 'Open-source weaving loom',
    projectAr: 'نول نسيج مفتوح المصدر',
    descriptionEn: 'A desktop loom that brings Bedouin sadu weaving to schools and makerspaces.',
    descriptionAr: 'نول مكتبي يُدخل نسيج السدو البدوي إلى المدارس ومساحات الصنّاع.',
    booth: 'B2',
    categories: ['best-design', 'community-choice'],
  },
  {
    nameEn: 'GripForm',
    nameAr: 'غريب فورم',
    projectEn: 'Custom prosthetic grips',
    projectAr: 'مقابض أطراف صناعية مخصّصة',
    descriptionEn: 'Scan-to-print prosthetic hand grips fitted in a single afternoon.',
    descriptionAr: 'مقابض لليد الصناعية تُمسح ضوئياً وتُطبع وتُركّب في فترة ما بعد ظهر واحدة.',
    booth: 'B3',
    categories: ['most-innovative', 'community-choice', 'best-design'],
  },
  {
    nameEn: 'Desert Drone Club',
    nameAr: 'نادي طائرات الصحراء',
    projectEn: 'Seed-bombing drone',
    projectAr: 'طائرة مسيّرة لبذر الأشجار',
    descriptionEn: 'A student-built drone that plants native seeds across degraded land.',
    descriptionAr: 'طائرة مسيّرة صنعها طلاب تزرع بذوراً محلية في الأراضي المتدهورة.',
    booth: 'C1',
    categories: ['most-innovative'],
  },
  {
    nameEn: 'Clay & Code',
    nameAr: 'طين وبرمجة',
    projectEn: 'Robotic pottery wheel',
    projectAr: 'دولاب فخار آلي',
    descriptionEn:
      'Parametric ceramics: a programmable wheel that shapes traditional Jordanian pottery.',
    descriptionAr: 'فخار بارامتري: دولاب قابل للبرمجة يشكّل الفخار الأردني التقليدي.',
    booth: 'C2',
    categories: ['best-design', 'most-innovative'],
  },
  {
    nameEn: 'FixIt Café',
    nameAr: 'مقهى التصليح',
    projectEn: 'Community repair station',
    projectAr: 'محطة تصليح مجتمعية',
    descriptionEn: 'A mobile repair cart that has kept 2,000 gadgets out of landfill.',
    descriptionAr: 'عربة تصليح متنقلة أنقذت ٢٠٠٠ جهاز من مكبّات النفايات.',
    booth: 'C3',
    categories: ['community-choice'],
  },
  {
    nameEn: 'Qamar Kids',
    nameAr: 'قمر للأطفال',
    projectEn: 'Snap-together STEM kits',
    projectAr: 'ألعاب علمية قابلة للتركيب',
    descriptionEn: 'Screen-free electronics kits with Arabic storybooks for ages 6 to 12.',
    descriptionAr: 'ألعاب إلكترونية بلا شاشات مع قصص عربية للأعمار من ٦ إلى ١٢ سنة.',
    booth: 'D1',
    categories: ['community-choice', 'best-design'],
  },
  {
    nameEn: 'AquaFog',
    nameAr: 'أكوا فوغ',
    projectEn: 'Fog-harvesting mesh',
    projectAr: 'شبكة لحصاد الضباب',
    descriptionEn:
      'Biomimetic nets that pull drinking water from morning fog in the southern highlands.',
    descriptionAr:
      'شباك مستوحاة من الطبيعة تستخلص مياه الشرب من ضباب الصباح في المرتفعات الجنوبية.',
    booth: 'D2',
    categories: ['most-innovative'],
  },
  {
    nameEn: 'Woodcraft Wadi',
    nameAr: 'خشبيات الوادي',
    projectEn: 'Flat-pack olive-wood furniture',
    projectAr: 'أثاث قابل للتفكيك من خشب الزيتون',
    descriptionEn: 'Joinery-only furniture — no screws, no glue — made from pruned olive branches.',
    descriptionAr:
      'أثاث معتمد على التعشيق فقط — بلا براغٍ أو غراء — مصنوع من أغصان الزيتون المقلّمة.',
    booth: 'D3',
    categories: ['best-design'],
  },
];
