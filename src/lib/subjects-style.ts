// Colori per disciplina (punto colorato + fondo tenue), come nei chip del design Stitch.
type SubjectTone = { dot: string; chip: string };

const TONES: Record<string, SubjectTone> = {
  red: { dot: "bg-red-600 dark:bg-red-400", chip: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900/60" },
  amber: { dot: "bg-amber-600 dark:bg-amber-400", chip: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900/60" },
  indigo: { dot: "bg-indigo-600 dark:bg-indigo-400", chip: "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900/60" },
  teal: { dot: "bg-teal-600 dark:bg-teal-400", chip: "bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-900/60" },
  sky: { dot: "bg-sky-600 dark:bg-sky-400", chip: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900/60" },
  violet: { dot: "bg-violet-600 dark:bg-violet-400", chip: "bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900/60" },
  emerald: { dot: "bg-emerald-600 dark:bg-emerald-400", chip: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900/60" },
  rose: { dot: "bg-rose-600 dark:bg-rose-400", chip: "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900/60" },
  orange: { dot: "bg-orange-600 dark:bg-orange-400", chip: "bg-orange-50 text-orange-900 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900/60" },
  slate: { dot: "bg-slate-500 dark:bg-slate-400", chip: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700" },
};

const BY_SUBJECT: Record<string, keyof typeof TONES> = {
  "Anatomy": "amber",
  "Histology": "teal",
  "Embryology": "rose",
  "Biology": "emerald",
  "Genetics": "violet",
  "Chemistry": "sky",
  "Biochemistry": "indigo",
  "Physics": "slate",
  "Physiology": "red",
  "Microbiology": "emerald",
  "Immunology": "sky",
  "General Pathology": "orange",
  "Pathological Anatomy": "amber",
  "Pharmacology": "violet",
  "Semeiotics": "teal",
  "Internal Medicine": "indigo",
  "Cardiology": "red",
  "Neurology": "violet",
  "Surgery": "slate",
  "Pediatrics": "sky",
  "Obstetrics and Gynecology": "rose",
  "Psychiatry": "indigo",
  "Hygiene and Public Health": "emerald",
  "Forensic Medicine": "slate",
  "Medical Statistics": "sky",
  "Other": "slate",
};

export function subjectTone(subject: string): SubjectTone {
  return TONES[BY_SUBJECT[subject] ?? "slate"];
}
