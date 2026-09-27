export const SUBJECTS = [
  "Anatomy",
  "Histology",
  "Embryology",
  "Biology",
  "Genetics",
  "Chemistry",
  "Biochemistry",
  "Physics",
  "Physiology",
  "Microbiology",
  "Immunology",
  "General Pathology",
  "Pathological Anatomy",
  "Pharmacology",
  "Semeiotics",
  "Internal Medicine",
  "Cardiology",
  "Neurology",
  "Surgery",
  "Pediatrics",
  "Obstetrics and Gynecology",
  "Psychiatry",
  "Hygiene and Public Health",
  "Forensic Medicine",
  "Medical Statistics",
  "Other",
] as const;

export type Subject = (typeof SUBJECTS)[number];

export function isSubject(value: string): value is Subject {
  return (SUBJECTS as readonly string[]).includes(value);
}

/** Nomi italiani usati dalle versioni precedenti → nomi attuali (migrazione dei dati salvati). */
export const LEGACY_SUBJECTS: Record<string, Subject> = {
  "Anatomia": "Anatomy",
  "Istologia": "Histology",
  "Embriologia": "Embryology",
  "Biologia": "Biology",
  "Genetica": "Genetics",
  "Chimica": "Chemistry",
  "Biochimica": "Biochemistry",
  "Fisica": "Physics",
  "Fisiologia": "Physiology",
  "Microbiologia": "Microbiology",
  "Immunologia": "Immunology",
  "Patologia generale": "General Pathology",
  "Anatomia patologica": "Pathological Anatomy",
  "Farmacologia": "Pharmacology",
  "Semeiotica": "Semeiotics",
  "Medicina interna": "Internal Medicine",
  "Cardiologia": "Cardiology",
  "Neurologia": "Neurology",
  "Chirurgia": "Surgery",
  "Pediatria": "Pediatrics",
  "Ginecologia e ostetricia": "Obstetrics and Gynecology",
  "Psichiatria": "Psychiatry",
  "Igiene e sanità pubblica": "Hygiene and Public Health",
  "Medicina legale": "Forensic Medicine",
  "Statistica medica": "Medical Statistics",
  "Altro": "Other",
};
