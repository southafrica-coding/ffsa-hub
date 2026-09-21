// Categories for the staff CV card (migration 218). This is the single
// place to extend if a genuinely new category is ever needed — add a
// literal here, extend the CHECK constraint on staff_cv_entries.category
// in a small follow-up migration, and it shows up everywhere the card
// renders. 'other' already covers anything unanticipated, so most future
// requests won't need a new category at all.

export type CvEntryCategory = "involvement" | "training" | "skill" | "other";

export const CV_ENTRY_CATEGORIES: {
  value: CvEntryCategory;
  label: string;
  addLabel: string;
  placeholder: string;
  description: string;
}[] = [
  {
    value: "involvement",
    label: "Past involvement",
    addLabel: "Add involvement",
    placeholder: "e.g. YWAM Cape Town, DTS staff",
    description: "Schools or ministry you did with us or another YWAM / FF base.",
  },
  {
    value: "training",
    label: "Training",
    addLabel: "Add training",
    placeholder: "e.g. First Aid Certification",
    description: "Training you've received with us.",
  },
  {
    value: "skill",
    label: "Skills",
    addLabel: "Add skill",
    placeholder: "e.g. Worship leading",
    description: "Anything specific you're skilled at.",
  },
  {
    value: "other",
    label: "Other",
    addLabel: "Add something else",
    placeholder: "e.g. Fluent in Portuguese",
    description: "Anything else worth adding to your CV.",
  },
];

export function cvCategoryLabel(value: string): string {
  return CV_ENTRY_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
